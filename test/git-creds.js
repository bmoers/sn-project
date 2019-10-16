const Git = require('../lib/git');


const git = new Git({
    dir: 'C:\\cicd\\user-test-20',
    user: {
        name: "bmoers",
        email: "boris@moers.ch",
        password: "********************************",
        store: true
    },
    remoteUrl: "https://github.com/bmoers/a_global_scoped_app.git"
})

git.init('no-build');

/*
git.toBranchName('Virtual Application - APP - 1.1.4@07cdc464dbd167c0432cfc600f9619e7').then((config) => {
    console.log(config);
})
*/
