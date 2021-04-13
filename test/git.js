const Git = require('../lib/git');
const pf = require('../lib/project-file');
const path = require('path');


const root = 'C:\\cicd\\repos\\21c4ee7a-3ed2-4b0a-8a56-8a1837d3b598---5';
const git = new Git({ dir: root, quiet: false });

git.init('no-build').then(() => {

    const fileName = '-1- this & is § a % test.js';
    const filePath = path.resolve(root, fileName);

    return pf.writeFileAsync(filePath, 'hello').then(() => {
        return git.add(filePath).then((out) => { console.log(out); });
    });


});



/*
git.toBranchName('Virtual Application - APP - 1.1.4@07cdc464dbd167c0432cfc600f9619e7').then((config) => {
    console.log(config);
})
*/
