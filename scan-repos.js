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
        .option("repo", {
            alias: "r",
            description: "repo",
            global: true,
            demandOption: true
        }).argv;
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

        let results = [];
        for (let i = 0; i < out.data.items.length; i++) {
            let item = out.data.items[i]
            results.push({
                repository: item.repository.name,
                url: item.repository.html_url,

            });

        }


        //
        // let out = await client.request(`GET /orgs/${argv.org}/repos`, {
        //     org: argv.org,
        //     headers: {
        //         'X-GitHub-Api-Version': '2022-11-28'
        //     }
        // })
        //
        // // Print repos in org
        // for (let i = 0; i < out.data.length; i++) {
        //     console.log(out.data[i].name);
        // }
        //

        // checkout passed in repo
        // shell.exec(`GIT_CURL_VERBOSE=1 git clone https://${argv.token}@github.com/${argv.org}/${argv.repo}.git`)
        //
        // if (shell.exec(`grep -qiR "${GHAS_SEARCH_STRING}" ${argv.repo}`).code !== 0) {
        //     console.error('GHAS Not Found')
        // } else {
        //     console.log('GHAS Found')
        // }
        //
        //
        // loop through results
        for (let i = 0; i < results.length; i++) {
            const repo = results[i].repository

            let response = await client.request(`GET /repos/{owner}/{repo}/code-scanning/alerts`, {
                owner: argv.org,
                repo: repo,
                headers: {
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            })
            
            console.log(`Code Scanning Alerts for ${repo}`)

            // print code scanning alerts
            for (let i = 0; i < response.data.length; i++) {
                console.log(response.data[i].rule.name);
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
