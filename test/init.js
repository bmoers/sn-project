const os = require('os');
const Git = require('../lib/git');

let git = new Git({
    quiet: true,
    dir: `${os.tmpdir()}/git-branchname-test`,
    remoteUrl: 'git@github.com:bmoers/x_11413_cicd_test.git'
});

(async ()=>{

    console.log('init start');
    await git.init();
    console.log('init done');

    await git.switchToBranch('sample_branch_xxxx');
        
    await git.add('tmp.file');
    await git.commit('gula');
    await git.push('sample_branch_xxxx');
    
    //await git.push('sample_branch_3');
    
    /*
    git = new Git({
        quiet: false,
        dir: `${os.tmpdir()}/git-branchname-test`,
        remoteUrl: 'git@github.com:bmoers/x_11413_cicd_test.git'
    });
    console.log('git2 init start');
    await git.init();

    console.log('git2 init done');

    //await git.switchToBranch('sample_branch');
    await git.push('sample_branch');
    */
})();

