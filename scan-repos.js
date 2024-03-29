import { throttling } from "@octokit/plugin-throttling";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { Octokit } from "@octokit/core";
import shell from 'shelljs';
import yargs from 'yargs';
import util from 'util';

const MyOctokit = Octokit.plugin(throttling, paginateRest);

async function main() {

    const argv = yargs(process.argv)
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
        .option("nag-number", {
            alias: "n",
            description: "Number of issues to create to warn users of non compliance",
            global: true,
            demandOption: false,
            default: 3
        })
        .count("verbose")
        .option("verbose", {
            alias: "v",
            description: "set verbose logging",
            global: true,
            demandOption: false,
            type: "boolean",
            default: false
        })
        .argv;

    const VERBOSITY_LEVEL = argv.verbose
    const NAG_NUMBER = argv.nagNumber

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

                    if (retryCount < 5) {
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
                dependabot_scanning_enabled: false,
                all_alerts_closed: false,
                visibility: undefined
            });

        }

        // loop through results
        for (const repository of actions_repositories) {
            let repository_configuration = await client.request(`GET /repos/{owner}/{repo}`, {
                owner: argv.org,
                repo: repository.name,
                headers: {
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            })

            repository.visibility = repository_configuration.data.visibility // kind of nasty but this should set the value in the actions_repositories object which we can use later

            logger.debug(`${util.inspect(repository_configuration, { depth: null })}`)

            repository['description'] = repository_configuration.data.description ?? ''
            repository['default_branch'] = repository_configuration.data.default_branch
            repository['scanning_enabled'] = repository_configuration.data.security_and_analysis?.advanced_security?.status === 'enabled'
            repository['dependabot_scanning_enabled'] = repository_configuration.data.security_and_analysis?.dependabot_security_updates?.status === 'enabled'

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
                    code_scanning_alerts = await client.paginate(`GET /repos/{owner}/{repo}/code-scanning/alerts`, {
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
                    }
                }
                
                // if ther are no results then all alerts are closed remains false
                if (code_scanning_alerts) {
                    logger.debug(code_scanning_alerts)
                    const open_alerts = code_scanning_alerts.filter(alert => alert.state === 'open')

                    // if there are no alerts, print a message
                    if (open_alerts.length == 0) {
                        logger.info("No alerts found")
                        repository['all_alerts_closed'] = true
                    } else {
                        repository['all_alerts_closed'] = false
                        // print code scanning alerts
                        for (let i = 0; i < code_scanning_alerts.length; i++) {
                            logger.info(code_scanning_alerts[i].rule.name);
                        }
                    }
                }
            }

            if(repository.dependabot_scanning_enabled){
                let dependabot_alerts
                try {
                    dependabot_alerts = await client.paginate(`GET /repos/{owner}/{repo}/dependabot/alerts`, {
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
                        logger.info(`No dependabot alerts: ${error}`)
                    }
                }
                
                // if ther are no results then all alerts are closed remains false
                if (dependabot_alerts) {
                    logger.debug(dependabot_alerts)
                    const open_alerts = dependabot_alerts.filter(alert => alert.state === 'open')

                    // if there are no alerts, print a message
                    if (open_alerts.length == 0) {
                        logger.info("No alerts found")
                        repository['all_alerts_closed'] = true
                    } else {
                        repository['all_alerts_closed'] = false
                        // print code scanning alerts
                        for (let i = 0; i < dependabot_alerts.length; i++) {
                            logger.info(dependabot_alerts[i].security_advisory.cve_id);
                        }
                    }
                }

            }
        }

        // print results
        logger.debug(`${JSON.stringify(actions_repositories)}`)

        // loop through repositories
        for (const repo of actions_repositories) {
            logger.debug(`Repo ${repo.name} scanning enabled: ${repo.scanning_enabled} scanning workflow: ${repo.scanning_workflow} dependabot scanning enabled: ${repo.dependabot_scanning_enabled} all alerts closed: ${repo.all_alerts_closed}`)
            // if scanning is enabled, and there are alerts, and there are open alerts, nag
            if (!repo.scanning_enabled || !repo.scanning_workflow || !repo.all_alerts_closed || !repo.dependabot_scanning_enabled) {
                if (repo.description === '') {
                    logger.info(`Description is empty, can't sync upstream to ${repo.name}`)
                } else {
                    try {
                        const verbosity = logger.VERBOSITY_LEVEL >= 2 == true ? 'GIT_CURL_VERBOSE=1 ' : ''
                        if (shell.exec(`${verbosity}git clone https://${argv.token}@github.com/${argv.org}/${repo.name}.git`, 
                            { silent: logger.VERBOSITY_LEVEL < 2 }).code === 0) {
                            shell.exec(`cd ${repo.name} && 
                                curl https://raw.githubusercontent.com/repo-sync/github-sync/3832fe8e2be32372e1b3970bbae8e7079edeec88/github-sync.sh > github-sync.sh`)
                            shell.exec(`pwd && cd ${repo.name} && GITHUB_TOKEN="${argv.token}" GITHUB_REPOSITORY="${argv.org}/${repo.name}" SYNC_TAGS="true" \
                                bash github-sync.sh ${repo.description} "${repo.default_branch}:${repo.default_branch}-sync"`)
                            // Get common ancestor
                            const common_ancestor = shell.exec(`cd ${repo.name} && git merge-base remotes/origin/${repo.default_branch}-sync HEAD`, 
                                { silent: logger.VERBOSITY_LEVEL < 2 }).stdout
                            // Get head of sync branch
                            const sync_head = shell.exec(`cd ${repo.name} && git show-ref remotes/origin/${repo.default_branch}-sync -s`, 
                                { silent: logger.VERBOSITY_LEVEL < 2 }).stdout
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
                                    const org_admins = await client.paginate(`GET /orgs/{org}/members`, {
                                        org: argv.org,
                                        role: "admin",
                                        headers: {
                                            'X-GitHub-Api-Version': '2022-11-28'
                                        }
                                    })

                                    logger.debug(`Org Admins: ${util.inspect(org_admins, { depth: null })}`)
                                    for (const member of org_admins) {
                                        logger.debug(`${util.inspect(member, { depth: null })}`)
                                        reviewers += ` --reviewer ${member.login}`
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

                // check if nagged 3 times
                const issues = await client.paginate(`GET /repos/{owner}/{repo}/issues`, {
                    owner: argv.org,
                    repo: repo.name,
                    state: "all",
                    labels: "non-compliant",
                    headers: {
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                })

                if (issues.length > NAG_NUMBER) {
                    if (repo.visibility !== 'public') {
                        await client.request(`PUT /repos/{owner}/{repo}/actions/permissions/access`, {
                            owner: argv.org,
                            repo: repo.name,
                            access_level: "none",
                            headers: {
                                'X-GitHub-Api-Version': '2022-11-28'
                            }
                        })
                    }

                    await client.request(`POST /repos/{owner}/{repo}/issues`, {
                        owner: argv.org,
                        repo: repo.name,
                        title: 'Repository Disabled for Actions',
                        body: 'This repository has been disabled for use within actions due to non-compliance.  Please remediate by enabling code scanning and resolving all alerts before contacting the GitHub Organization Admins to re-enable this Action.',
                        labels: ['non-compliant'],
                        headers: {
                            'X-GitHub-Api-Version': '2022-11-28'
                        }
                    })
                } else {
                    // nag
                    await client.request(`POST /repos/{owner}/{repo}/issues`, {
                        owner: argv.org,
                        repo: repo.name,
                        title: 'Repository Non-Compliant for use with GitHub Actions',
                        body: 'This repository is non-compliant for use with GitHub Actions.  To remediate this please make sure Dependabot and code-scanning are enabled and all alerts are resolved. If applicable, a PR has been opened to merge upstream into this repository in hopes that it helps this repository come back in to compliance.  This repository will be disabled for use within actions after the 3rd notification.',
                        labels: ['non-compliant'],
                        headers: {
                            'X-GitHub-Api-Version': '2022-11-28'
                        }
                    })
                }
            }
        }
    } catch (error) {
        logger.error(error);
        process.exit(1)
    }
}

main();
