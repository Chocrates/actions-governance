const { throttling } = require("@octokit/plugin-throttling");
const { Octokit } = require("@octokit/rest");
const shell = require('shelljs')
const yargs = require('yargs')
const util = require('util')

const MyOctokit = Octokit.plugin(throttling);

async function main() {

    const argv = yargs
        .option("token", {
            alias: "t",
            description: "personal access token with which to authenticate",
            global: true,
            demandOption: true,
        })
        .option("org", {
            alias: "o",
            description: "org",
            global: true,
            demandOption: true
        })
        .count("verbose")
        .option("verbose", {
            alias: "v",
            description: "set verbose logging",
            global: true,
            demandOption: false,
            type: "boolean",
            dfeault: false
        })
        .argv;

    const VERBOSITY_LEVEL = argv.verbose

    const logger = {
        error: (message) => { console.error(message) },
        warn: (message) => { if (VERBOSITY_LEVEL >= 0) { console.warn(message) } },
        info: (message) => { if (VERBOSITY_LEVEL >= 1) { console.info(message) } },
        debug: (message) => { if (VERBOSITY_LEVEL >= 2) { console.debug(message) } },
        log: (message) => { console.log(message) }
    }


    try {
        // const ACTION_SEARCH_STRING = "/^action.yml$/"  // Code search api doesn't support regexes via the API yet
        const ACTION_SEARCH_STRING = "filename:action.yml path:/"
        const SECURITY_SCANNING_SEARCH_STRING = "github/codeql-action/analyze@v2 in:file"
        const client = new MyOctokit({
            auth: `token ${argv.token}`,
            previews: ["luke-cage"],
            throttle: {
                onRateLimit: (retryAfter, options, octokit, retryCount) => {
                    octokit.log.warn(
                        `Request quota exhausted for request ${options.method} ${options.url}`,
                    );

                    if (retryCount < 1) {
                        // only retries once
                        octokit.log.info(`Retrying after ${retryAfter} seconds!`);
                        return true;
                    }
                },
                onSecondaryRateLimit: (retryAfter, options, octokit) => {
                    // does not retry, only logs a warning
                    octokit.log.warn(
                        `SecondaryRateLimit detected for request ${options.method} ${options.url}`,
                    );
                },
            },
        });

        // search for code in org
        let search_results = await client.request(`GET /search/code`, {
            q: `org:${argv.org} ${ACTION_SEARCH_STRING}`,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }

        })

        logger.debug(search_results)
        // print search results
        logger.debug(`Search Results: ${util.inspect(search_results.data.items, { depth: null })}`)


        let actions_repositories = [];
        for (let i = 0; i < search_results.data.items.length; i++) {
            let item = search_results.data.items[i]
            actions_repositories.push({
                name: item.repository.name,
                url: item.repository.html_url,
                scanning_enabled: false,
                scanning_workflow: false,
                all_alerts_closed: false
            });

        }

        // loop through results
        for (let i = 0; i < actions_repositories.length; i++) {
            const repository = actions_repositories[i]

            let repository_configuration = await client.request(`GET /repos/{owner}/{repo}`, {
                owner: argv.org,
                repo: repository.name,
                headers: {
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            })

            logger.debug(`${util.inspect(repository_configuration, { depth: null })}`)

            repository['description'] = repository_configuration.data.description ?? ''
            repository['default_branch'] = repository_configuration.data.default_branch
            repository['scanning_enabled'] = repository_configuration.data.security_and_analysis?.advanced_security?.status === 'enabled'

            // search for code in org
            let search_code_scanning_results = await client.request(`GET /search/code`, {
                q: `repo:${argv.org}/${repository.name} ${SECURITY_SCANNING_SEARCH_STRING}`,
                headers: {
                    'X-GitHub-Api-Version': '2022-11-28'
                }

            })

            logger.debug(`${util.inspect(search_code_scanning_results, { depth: null })}`)

            repository['scanning_workflow'] = search_code_scanning_results.data?.total_count > 0

            if (repository.scanning_enabled && repository.scanning_workflow) {

                let code_scanning_alerts
                try {
                    code_scanning_alerts = await client.request(`GET /repos/{owner}/{repo}/code-scanning/alerts`, {
                        owner: argv.org,
                        repo: repository.name,
                        headers: {
                            'X-GitHub-Api-Version': '2022-11-28'
                        }
                    })
                } catch (error) {
                    // ignore 404 errors
                    if (error.status !== 404) {
                        throw error
                    } else {
                        logger.info(`No scanning results: ${error}`)
                        break
                    }
                }


                logger.debug(code_scanning_alerts)
                const open_alerts = code_scanning_alerts.data.filter(alert => alert.state === 'open')

                // if there are no alerts, print a message
                if (open_alerts.length == 0) {
                    logger.info("No alerts found")
                    repository['all_alerts_closed'] = true
                } else {
                    repository['all_alerts_closed'] = false
                    // print code scanning alerts
                    for (let i = 0; i < code_scanning_alerts.data.length; i++) {
                        logger.info(code_scanning_alerts.data[i].rule.name);
                    }
                }

            }
        }

        // print results
        logger.debug(`${JSON.stringify(actions_repositories)}`)

        /*
        
                  node scan-repos.js -t ${{ secrets.ORG_TOKEN }} -o ${{ github.repository_owner }} | 
                    jq -c '.[]' | 
                    while read i; do 
                      # Set json object as bash variables
                      eval $(echo $i | jq -r '. | to_entries | .[] | .key + "=" + (.value | @sh)')
        
                      if [[ $scanning_enabled != true || $scanning_workflow != true || $all_alerts_closed != true ]]; then
                        if [[ -z "$description" ]]; then
                          echo "Description is empty, can't sync upstream to $name"
                        else
                          git clone https://${{ secrets.ORG_TOKEN }}@github.com/${{ github.repository_owner }}/$name.git
                          cd $name
                          curl https://raw.githubusercontent.com/repo-sync/github-sync/3832fe8e2be32372e1b3970bbae8e7079edeec88/github-sync.sh > github-sync.sh
        
                          GITHUB_TOKEN="${{ secrets.ORG_TOKEN }}" GITHUB_REPOSITORY="${{ github.repository_owner }}/$name" bash github-sync.sh $description "$default_branch:$default_branch-sync"
                          
                          # Get common ancestor
                          COMMON_ANCESTOR=$(git merge-base remotes/origin/$default_branch-sync HEAD)
                          # Get head of sync branch
                          SYNC_HEAD=$(git show-ref remotes/origin/$default_branch-sync -s)
                          # Open a PR if there is stuff to merge
                          if [[ $COMMON_ANCESTOR != $SYNC_HEAD ]]; then
                            
                            # Find Admin Team
                            TEAMS_WITH_MEMBERS=()
                            ADMIN_TEAMS=$(gh api /repos/chocrates-test-org/go-dependency-submission/teams | jq -c '.[] | select(.permission == "admin")');
                            IFS=$'\n'
                            for CURRENT_TEAM in $ADMIN_TEAMS; do                                                                                                                                                                                                  
                              CURRENT_TEAM_MEMBERS=$(GH_PAGER='' gh api $(echo $CURRENT_TEAM | jq '.members_url' | sed 's/"\(.*\){\/member}"/\1/'))
                              if [[ $(echo $CURRENT_TEAM_MEMBERS | jq '. | length') -gt 0 ]]; then
                                echo "Current Team: $CURRENT_TEAM"
                                TEAMS_WITH_MEMBERS+=($CURRENT_TEAM)
                              else
                                echo "Team $(echo $CURRENT_TEAM | jq '.name') doesn't have members"
                              fi
                            done
                            
                            echo "Teams with Members $TEAMS_WITH_MEMBERS"
        
                            gh pr --repo "${{ github.repository_owner }}/$name" create --title "Merge Upstream" \
                              --body "This repository is non-compliant.  This PR has been automatically generated to help you merge Upstream in hopes that it helps come in to compliance" \
                              --base $default_branch --head "$default_branch-sync" \
                              --reviewer @chocrates-test-org/one
                              
                          else
                            echo "Common ancestor matches upstream so nothing to merge"
                          fi
                          
                          # node notify-non-compliance -t ${{ secrets.ORG_TOKEN }} -o ${{ github.repository_owner }} -r $name
                          cd ..
                          rm -rf $name
                        fi
                      else
                        echo "don't nag"
                      fi
                    done
        */



        // loop through repositories
        for (const repo of actions_repositories) {
            logger.debug(`Repo ${repo.name} scanning enabled: ${repo.scanning_enabled} scanning workflow: ${repo.scanning_workflow} all alerts closed: ${repo.all_alerts_closed}`)
            // if scanning is enabled, and there are alerts, and there are open alerts, nag
            if (!repo.scanning_enabled || !repo.scanning_workflow || !repo.all_alerts_closed) {
                if (repo.description === '') {
                    logger.info(`Description is empty, can't sync upstream to ${repo.name}`)
                } else {
                    try {
                        const verbosity = logger.VERBOSITY_LEVEL >= 2 == true ? 'GIT_CURL_VERBOSE=1 ' : ''
                        if (shell.exec(`${verbosity}git clone https://${argv.token}@github.com/${argv.org}/${repo.name}.git`, { silent: logger.VERBOSITY_LEVEL < 2 }).code === 0) {
                            shell.exec(`cd ${repo.name} && curl https://raw.githubusercontent.com/repo-sync/github-sync/3832fe8e2be32372e1b3970bbae8e7079edeec88/github-sync.sh > github-sync.sh`)
                            shell.exec(`pwd && cd ${repo.name} && GITHUB_TOKEN="${argv.token}" GITHUB_REPOSITORY="${argv.org}/${repo.name}" bash github-sync.sh ${repo.description} "${repo.default_branch}:${repo.default_branch}-sync"`)
                            // Get common ancestor
                            const common_ancestor = shell.exec(`cd ${repo.name} && git merge-base remotes/origin/${repo.default_branch}-sync HEAD`, { silent: logger.VERBOSITY_LEVEL < 2 }).stdout
                            // Get head of sync branch
                            const sync_head = shell.exec(`cd ${repo.name} && git show-ref remotes/origin/${repo.default_branch}-sync -s`, { silent: logger.VERBOSITY_LEVEL < 2 }).stdout
                            // Open a PR if there is stuff to merge
                            if (common_ancestor != sync_head) {
                                // Find Admin Team
                                const teams_with_members = []
                                const admin_teams = await client.paginate(`GET /repos/${argv.org}/${repo.name}/teams`, {
                                    headers: {
                                        'X-GitHub-Api-Version': '2022-11-28'

                                    }
                                })

                                logger.debug(`Admin Teams: ${util.inspect(admin_teams, { depth: null })}`)

                                for (const team of admin_teams) {
                                    const current_team_members = await client.paginate(`GET ${team.members_url.replace(/{\/member}/, '')}`, {
                                        headers: {
                                            'X-GitHub-Api-Version': '2022-11-28'
                                        }

                                    })
                                    logger.debug(`Team Members: ${util.inspect(current_team_members, { depth: null })}`)

                                    if (current_team_members.length > 0) {
                                        teams_with_members.push(team)
                                    }
                                }

                                logger.debug(`Teams with Members: ${util.inspect(teams_with_members, { depth: null })}`)

                                let reviewers = ''
                                // If teams with members empty, find org admins
                                if (teams_with_members.length === 0) {
                                    const org_admins = await client.request(`GET /orgs/{org}/members`, {
                                        org: argv.org,
                                        role: "admin",
                                        headers: {
                                            'X-GitHub-Api-Version': '2022-11-28'
                                        }
                                    })

                                    logger.debug(`Org Admins: ${util.inspect(org_admins, { depth: null })}`)
                                    for (const member of org_admins) {
                                        logger.debug(`${util.inspect(member, { depth: null })}`)
                                        reviewers += ` --reviewer @${member.login}`
                                    }
                                } else {
                                    for (const team of teams_with_members) {
                                        logger.debug(`${util.inspect(team, { depth: null })}`)
                                        reviewers += ` --reviewer @${argv.org}/${team.name}`
                                    }
                                }

                                logger.debug(`Reviewers: ${util.inspect(reviewers, { depth: null })}`)
                                shell.exec(`gh pr --repo ${argv.org}/${repo.name} create --title "Merge Upstream" --body "This repository is non-compliant.  This PR has been automatically generated to help you merge Upstream in hopes that it helps come in to compliance" --base ${repo.default_branch} --head "${repo.default_branch}-sync" ${reviewers}`)

                            } else {
                                logger.info('Common Ancestor matches upstream so nothing to merge')
                            }
                        } else {
                            logger.warn(`Failed to clone ${repo.name}`)
                        }
                    } catch (error) {
                        logger.error(error)
                    }
                    finally {
                        shell.exec(`rm -rf ${repo.name}`)
                    }
                }
            }
        }
    } catch (error) {
        logger.error(error);
    }
}


if (require.main == module) {
    main();
}

module.exports = main;
