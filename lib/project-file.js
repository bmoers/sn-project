var Promise = require('bluebird');

var fs = require("fs-extra");
var deleteEmpty = Promise.promisifyAll(require('delete-empty'));
var path = require("path");

const promiseFor = Promise.method((condition, action, value) => {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

function getDirName(dir) {
    try {
        if (fs.lstatSync(dir).isDirectory()) {
            return dir;
        }
        return path.dirname(dir);
    } catch (ignore) {
        const parsed = path.parse(dir);
        if (parsed.ext)
            return parsed.dir;
        return path.join(parsed.dir, parsed.name);
    }
}

function copyFileAsync(source, target, options) {
    return fs.copy(source, target, options);
}
exports.copyFileAsync = copyFileAsync;

function mkdirpAsync(fullPath) {
    return fs.mkdirp(getDirName(fullPath));
}
exports.mkdirpAsync = mkdirpAsync;

function writeFileAsync(fullFilePath, contents, options) {
    // append newline if there is none : "It's not about adding an extra newline at the end of a file, it's about not removing the newline that should be there."
    return fs.outputFile(fullFilePath, (!((/\n$/).test(contents))) ? `${contents}\n` : contents, Object.assign({
        encoding: 'utf8'
    }, options));
}
exports.writeFileAsync = writeFileAsync;

function move(from, to) {
    return fs.move(from, to, { overwrite: true });
}
exports.move = move;

function renameFileAsync(from, to) {
    return fs.rename(from, to);
}
exports.renameFileAsync = renameFileAsync;

function readFileAsync(filePath) {
    return fs.readFile(path.join(filePath), { encoding: 'utf8' });
}
exports.readFileAsync = readFileAsync;

function exists(fullFilePath) {
    return fs.pathExists(fullFilePath);
}
exports.exists = exists;

function deleteEmptyDirAsync(fullFilePath) {
    return deleteEmpty(getDirName(fullFilePath)).catch((e) => {
        console.error('deleteEmptyDirAsync failed for path:', fullFilePath, e);
    });
}
exports.deleteEmptyDirAsync = deleteEmptyDirAsync;


function deleteEmptyDirUpwards(fullFilePath) {
    return promiseFor((next) => (next), (dir) => {
        return deleteEmptyDirAsync(dir).then((res) => {
            if (!res.length)
                return false;
            return path.resolve(dir, '../');
        });
    }, fullFilePath);
}
exports.deleteEmptyDirUpwards = deleteEmptyDirUpwards;

function deleteFileAsync(fullFilePath, removeEmptyDirectory) {
    return exists(fullFilePath).then((exists) => {
        if (!exists)
            return false

        return fs.remove(fullFilePath).then(() => {
            if (removeEmptyDirectory === true)
                return deleteEmptyDirAsync(fullFilePath);
        }).then(() => {
            return true
        });

    }).catch((e) => {
        console.error('deleteFileAsync', fullFilePath, removeEmptyDirectory, e);
        return false
    });
}
exports.deleteFileAsync = deleteFileAsync;
