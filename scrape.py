import argparse
import os
import logging
import sys
import json
from time import sleep
import requests
from pathlib import Path


class OptumSearchAction():

    """

    Class to drive the OptumFile auditing workflow

    """

    def __init__(self):
        """

        Initialize the class

        """

        from datetime import datetime

        self.fileappend = datetime.today().strftime('%Y%m%d%H%M%S')
        report_path = 'run_reports'
        Path(report_path).mkdir(parents=True, exist_ok=True)

        filename = f'{report_path}/debug.{self.fileappend}.log'

        self.logger = self.logger = logging.getLogger(__name__)

        self.logger.setLevel(os.environ.get('LOGGING_LEVEL', 'INFO'))

        self.logger.handlers = [

            logging.FileHandler(filename),

            logging.StreamHandler()

        ]

        self.token = os.environ.get('GHEC_API_TOKEN', None)

        if self.token is None:

            raise Exception(
                'Required environment variable: GHEC_API_TOKEN is missing')

        self.action = action

    def search(self):
        """

        Iterate through all the repos in the organization and archive each one

        :param org_name: The name of the organization

        """

        # https://github.com/search?q=org%3Auhg-internal%20uses%3A%20uhg-actions%2Fsemantic-release-action%40v3&type=code

        BASEURL=f'https://api.github.com/search/code?q=org:chocrates-test-org uses: actions/{self.action}&sort=desc&order=stars&per_page=30&page=1'

        print(BASEURL)

        headers = {

            "Authorization": "Bearer {}".format(self.token),

            "accept": "application/vnd.github+json",

            "X-GitHub-Api-Version": "2022-11-28"

        }

        response = requests.get(BASEURL, headers=headers)

        jq1 = json.loads(response.text)

        for x in range(len(jq1['items'])):

            print(jq1['items'][x]['repository']['full_name'])

        sleep(10)

    def run_workflow(self, action):
        """

        Runs the search workflow

        """

        self.action = action

        self.logger.info("Starting the search workflow")

        self.search()

        self.logger.info("Completed processing all organizations.")

        # Close the results


# Launch test from command line
if __name__ == '__main__':

    parser = argparse.ArgumentParser()

    parser.add_argument('-action', '--action')

    args = parser.parse_args()

    if args.action is None:

        exit()

    else:

        action = args.action

    logging.basicConfig(format='%(asctime)s %(levelname)s %(message)s',
                        level=logging.INFO, stream=sys.stdout)

    OptumSearchAction().run_workflow(action)
