const { throttling } = require("@octokit/plugin-throttling");
const { Octokit } = require("@octokit/rest");
const shell = require('shelljs')

const MyOctokit = Octokit.plugin(throttling);

async function main() {

    const argv = require("yargs")
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
        .option("verbose", {
            alias: "v",
            description: "set verbose logging",
            global: true,
            demandOption: false,
            type: "boolean",
            dfeault: false
        })
        .argv;

    const logger = {
        error: (message) => { console.error(message) },
        warn: (message) => { if (argv.verbose) { console.warn(message) } },
        debug: (message) => { logger.warn(message) },
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
        let out = await client.request(`GET /search/code`, {
            q: `org:${argv.org} ${ACTION_SEARCH_STRING}`,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }

        })

        logger.debug(out)

        let actions_repositories = [];
        for (let i = 0; i < out.data.items.length; i++) {
            let item = out.data.items[i]
            actions_repositories.push({
                name: item.repository.name,
                url: item.repository.html_url,

            });

        }

        // loop through results
        for (let i = 0; i < actions_repositories.length; i++) {
            const repository_name = actions_repositories[i].name

            let response = await client.request(`GET /repos/{owner}/{repo}/code-scanning/default-setup`, {
                owner: argv.org,
                repo: repository_name,
                headers: {
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            })

            // if scanning is enabled
            if (response.data.state === 'configured') {
                console.log('Code Scanning is configured')

                let response = await client.request(`GET /repos/{owner}/{repo}/code-scanning/alerts`, {
                    owner: argv.org,
                    repo: repository_name,
                    headers: {
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                })

                // if there are no alerts, print a message
                if (response.data.length == 0) {
                    console.log("No alerts found")
                } else {

                    // print code scanning alerts
                    for (let i = 0; i < response.data.length; i++) {
                        console.log(response.data[i].rule.name);
                    }
                }

            } else {
                console.log(`Code Scanning is not enabled for ${repository_name}`)
            }

        }

    } catch (error) {
        console.log(error);
    }
    finally {
        shell.exec(`rm -rf ${argv.repo}`)
    }
}


if (require.main == module) {
    main();
}

module.exports = main;
