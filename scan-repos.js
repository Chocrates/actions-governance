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

        // print actions_repository
        logger.log(`${util.inspect(actions_repositories, { depth: null })}`)

    } catch (error) {
        logger.error(error);
    }
    finally {
        shell.exec(`rm -rf ${argv.repo}`)
    }
}


if (require.main == module) {
    main();
}

module.exports = main;
