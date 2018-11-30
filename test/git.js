const Git = require('../lib/git');


const git = new Git({ dir: 'C:\\cicd\\repos\\21c4ee7a-3ed2-4b0a-8a56-8a1837d3b598' })


git.toBranchName('Virtual Application - APP - 1.1.4@07cdc464dbd167c0432cfc600f9619e7').then((config) => {
    console.log(config);
})