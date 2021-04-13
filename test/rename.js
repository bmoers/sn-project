const Git = require('../lib/git');


const git = new Git({ dir: 'C:\\cicd-server\\repos\\test', quiet: false });

git.switchToBranch('va-atf-collection-@8f392c88db052780432cfc600f9619c7');

/*
git.toBranchName('Virtual Application - APP - 1.1.4@07cdc464dbd167c0432cfc600f9619e7').then((config) => {
    console.log(config);
})
*/
