const project = require('../lib/project-file');


(async () => {
    await project.mkdirpAsync('/var/folders/97/nfkk6yh55277q5285mrgx6h00000gn/T/t/a/d/f/x/a.ch');
    await project.mkdirpAsync('/var/folders/97/nfkk6yh55277q5285mrgx6h00000gn/T/t/a/d/f/y/b.ch');

    await project.mkdirpAsync('/var/folders/97/nfkk6yh55277q5285mrgx6h00000gn/T/t/a/0/f/x/a.ch');
    await project.mkdirpAsync('/var/folders/97/nfkk6yh55277q5285mrgx6h00000gn/T/t/a/0/f/y/b.ch');

    const x = await project.writeFileAsync('/var/folders/97/nfkk6yh55277q5285mrgx6h00000gn/T/t/a/d/f/x/1.txt', 'bla');
    console.log(x);

    //const d = await project.deleteEmptyDirUpwards('/var/folders/97/nfkk6yh55277q5285mrgx6h00000gn/T/t/a/0/f');
    //console.log(d)

    const y = await project.deleteFileAsync('/var/folders/97/nfkk6yh55277q5285mrgx6h00000gn/T/t/a/d/1.txt',true);
    console.log(y);
})();

