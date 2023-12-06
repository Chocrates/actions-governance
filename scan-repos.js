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
        log: (message) => { logger.warn(message) }
    }


    try {
        // const ACTION_SEARCH_STRING = "/^action.yml$/"  // Code search api doesn't support regexes via the API yet
        const ACTION_SEARCH_STRING = "filename:action.yml path:/"
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
        logger.info(`Search Results: ${util.inspect(search_results.data.items, {depth: null})}`)


        let actions_repositories = [];
        for (let i = 0; i < search_results.data.items.length; i++) {
            let item = search_results.data.items[i]
            actions_repositories.push({
                name: item.repository.name,
                url: item.repository.html_url,

            });

        }

        // loop through results
        for (let i = 0; i < actions_repositories.length; i++) {
            const repository_name = actions_repositories[i].name

            let code_scanning_enabled = await client.request(`GET /repos/{owner}/{repo}/code-scanning/default-setup`, {
                owner: argv.org,
                repo: repository_name,
                headers: {
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            })

            logger.debug(code_scanning_enabled)

            // if scanning is enabled
            if (code_scanning_enabled.data.state === 'configured') {
                logger.info('Code Scanning is configured')

                let code_scanning_alerts = await client.request(`GET /repos/{owner}/{repo}/code-scanning/alerts`, {
                    owner: argv.org,
                    repo: repository_name,
                    headers: {
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                })

                logger.debug(code_scanning_alerts)

                // if there are no alerts, print a message
                if (code_scanning_alerts.data.length == 0) {
                    logger.info("No alerts found")
                } else {

                    // print code scanning alerts
                    for (let i = 0; i < code_scanning_alerts.data.length; i++) {
                        logger.info(code_scanning_alerts.data[i].rule.name);
                    }
                }

            } else {
                logger.error(`Code Scanning is not enabled for ${repository_name}`)
            }

        }

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
