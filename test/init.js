const Git = require('../lib/git');

const git = new Git({
    quiet: false,
    dir: '/private/tmp/test-dir',
    remoteUrl: 'git@github.com:bmoers/x_11413_cicd_test.git' //  git@github.com:bmoers/x_11413_cicd_test.git
})

git.init().catch((e) => {
    console.error(e)
});

