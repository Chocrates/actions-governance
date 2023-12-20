const { throttling } = require("@octokit/plugin-throttling");
const { Octokit } = require("@octokit/rest");
const { paginateRest } = require("@octokit/plugin-paginate-rest")
const shell = require('shelljs')
const yargs = require('yargs')
const util = require('util')

const MyOctokit = Octokit.plugin(throttling).plugin(paginateRest)

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
        .option("repo", {
            alias: "r",
            description: "repo",
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

    const NON_COMPLIANCE_TITLE = 'Action Non-Compliant With Security Polices'
    const NON_COMPLIANCE_BODY = 'This repository is Non-Compliant with security polices.  Please ensure that GitHub Advanced Security is enabled, running, and all alerts are remediated.  This repository will be disabled after 3 warnings until it comes into compliance.'

    try {
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


        // determine if this is the first nag or not
        const issues = await paginate_api(logger, client, 'GET /repos/{owner}/{repo}/issues', {
            owner: argv.org,
            repo: argv.repo,
            state: 'all',
            labels: 'non-compliance',
        })

        const collaborators = await paginate_api(logger, client, `GET /repos/{org}/{repo}/collaborators`, {
            org: argv.org,
            repo: argv.repo,
        })

        // get list of admins
        const admins = collaborators.filter(collaborator => collaborator.permissions.admin === true)

        if (issues.length === 0) {
            // First Nag
            const create_result = await client.request('POST /repos/{owner}/{repo}/issues', {
                owner: argv.org,
                repo: argv.repo,
                title: NON_COMPLIANCE_TITLE,
                body: NON_COMPLIANCE_BODY,
                labels: ['non-compliance'],
                assignees: admins.map(admin => admin.login),
                headers: {
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            })

            logger.log(util.inspect(create_result, { depth: null }))
        } else {
            // subsequent nag

        }

        logger.log(`Org: ${argv.org} Repo: ${argv.repo}`)
        logger.log(util.inspect(issues, { depth: null }))
    } catch (error) {
        logger.error(error);
    }
    finally {

    }
}

const paginate_api = async (logger, client, url, options) => {
    let api_call = await client.paginate(url, {
        ...options,
        per_page: 100,
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    })
    logger.debug(api_call)
    return api_call
}

if (require.main == module) {
    main();
}

module.exports = main;
