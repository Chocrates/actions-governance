const { throttling } = require("@octokit/plugin-throttling");
const { Octokit } = require("@octokit/rest");

const MyOctokit = Octokit.plugin(throttling);

async function main() {
    try {
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


        let out = await client.request('GET /orgs/${argv.org}/repos', {
            org: argv.org,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        })

        // Print repos in org
        for (let i = 0; i < out.data.length; i++) {
            console.log(out.data[i].name);
        }

        } catch (error) {
            console.log(error);
        }
    }


if (require.main == module) {
        main();
    }

    module.exports = main;
