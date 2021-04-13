require('dotenv').config();
const Git = require('../lib/git');


const git = new Git({
    dir: process.env.GIT_TEST_DIR,
    user: {
        name: process.env.GIT_USER_NAME,
        email: process.env.GIT_USER_EMAIL,
        password: process.env.GIT_PASSWORD,
        store: process.env.GIT_STORE == 'true'
    },
    remoteUrl: process.env.GIT_URL,
    quiet: process.env.GIT_QUIET == 'true',
    gitignore : ['.g','.c','.d','.e','.f']
});

git.init('no-build');

/*
git.toBranchName('Virtual Application - APP - 1.1.4@07cdc464dbd167c0432cfc600f9619e7').then((config) => {
    console.log(config);
})
*/
