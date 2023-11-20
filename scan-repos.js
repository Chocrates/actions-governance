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
        const GHAS_SEARCH_STRING = "uses: github/codeql-action/analyze@""
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
        shell.exec(`GIT_CURL_VERBOSE=1 git clone https://${argv.token}@github.com/${argv.org}/${argv.repo}.git`)

        if (shell.exec(`grep -qiR "${GHAS_SEARCH_STRING}" ${argv.repo}`).code !== 0) {
            shell.echo('GHAS Not Found');
            shell.exit(1);
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
