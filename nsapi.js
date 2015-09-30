'use strict';
var fs = require('fs'),
    vm = require('vm'),
    vmInclude = function (code, path) {
        vm.runInThisContext(code, path);
    },
    vmAddFile = function (path) {
        vmInclude(fs.readFileSync(path), path);
    },
    vmRmFile = function (path) {
        vmInclude('', path);
    };

// workaround to 'require' works in vm.runInThisContext
global.require = require;

vmInclude('var window = global;');
vmAddFile(__dirname + '/nsapi-doc.js');

// load Netsuite functions and objects
var glob = require('glob'),
    files = glob.sync(__dirname + '/src/**/*.js');
for (let i = 0; i < files.length; vmAddFile(files[i++]));

var $db;

const $GLOBAL_VARS = Object.keys(global).concat(['$GLOBAL_VARS', '$db', '$GLOBAL_REM']);
global.$GLOBAL_REM = global.$GLOBAL_REM || [];


function loadDatabase(cb) {
    let base = '.nsmockup',
        tempDir = base + '/temp-' + (new Date().toJSON().replace(/[-:.Z]/g, '')),
        dbDir = tempDir + '/db',
        dbPath = dbDir + '/db.json';

    [base, tempDir, dbDir].forEach(f => {
        !fs.existsSync(f) && fs.mkdirSync(f);
    });

    !fs.existsSync(dbPath) && fs.writeFileSync(dbPath, '{}');

    let low = require('lowdb'),
        db = low(dbPath);

    // create metadata collection
    if (!db.object.__metadata) {
        db.object.__metadata = [];
        db.save();
    }
    db.$path = tempDir;
    db.$pathDB = dbDir;
    db.$pathCabinet = tempDir + '/cabinet';

    cb($db = global.$db = db);
}

exports.init = function (opts, cb) {
    function init(db) {
        let metadatas = opts.metadatas;
        if (typeof metadatas === 'string') metadatas = [require(opts.records)];
        else if (!Array.isArray(metadatas)) metadatas = [metadatas];

        if (metadatas && metadatas.length !== 0) {
            let _metadata = db('__metadata');
            for (let i = 0; i < metadatas.length; i++) {
                let metadata = metadatas[i];
                if (typeof metadata === 'string') metadata = require(metadata);

                if (!metadata || !metadata.code) continue;
                else {
                    _metadata.remove({code: metadata.code});
                    _metadata.push(metadata);
                    //console.log('import record-type metadata "' + metadata.code + '"');
                }
            }
            db.save();
        }

        let records = opts.records;
        if (typeof records === 'string') records = require(opts.records);

        if (!records) return cb();
        let recNames = Object.keys(records);

        let actual = 0,
            verifyDone = function () {
                if (++actual == recNames.length) return cb();
            };
        for (let i = 0; i < recNames.length; i++) {
            let recName = recNames[i],
                recVal = records[recName];

            if (typeof recVal === 'string') recVal = require(recVal);
            if (!recVal || !recVal.length) {
                verifyDone();
                continue;
            }

            recVal = recVal.map((val, i) => {
                if (!val.internalid) val.internalid = (i + 1);
                return val;
            });

            // save record type data in lowdb database
            db.object[recName] = recVal;
            db.save();

            //console.log('import record-type "' + recName + '" - total: ' + recVal.length);
            verifyDone();
        }
    }

    if ($db) init($db);
    else loadDatabase(init);
};

exports.destroy = function (cb) {

    var rmAllDirs = function (path) {
        if (fs.existsSync(path)) {
            fs.readdirSync(path).forEach(function (file) {
                var curPath = path + '/' + file;
                if (fs.lstatSync(curPath).isDirectory()) { // recurse
                    rmAllDirs(curPath);
                } else { // delete file
                    fs.unlinkSync(curPath);
                }
            });
            fs.rmdirSync(path);
        }
    };

    function destroy(db) {
        db.object = {};
        db.save();

        rmAllDirs(db.$pathCabinet);

        let globalVars = Object.keys(global),
            globalRem = global.$GLOBAL_REM;
        for (let k = 0; k < globalVars.length; k++) {
            let globalVar = globalVars[k];
            if ((~globalRem.indexOf(globalVar) || !~$GLOBAL_VARS.indexOf(globalVar)) && global[globalVar]) {
                global[globalVar] = undefined;
                !~globalRem.indexOf(globalVar) && globalRem.push(globalVar);
            }
        }
        return cb();
    }

    if ($db) destroy($db);
    else loadDatabase(destroy);
};

exports.addScript = vmAddFile;

let scripts = [];
function createScript(opt) {
    if (!opt || !opt.files || opt.files.length === 0) return;

    scripts.push(opt);
    for (let i = 0; i < opt.files.length; i++) {
        vmAddFile(opt.files[i]);
    }
    if (opt.params) {
        let pref = nlapiGetContext().preference,
            keys = Object.keys(opt.params);
        for (let i=0; i<keys.length;i++) {
            let param = keys[i];
            pref[param] = opt.params[param];
        }
    }
}

exports.createSuitelet = createScript;

exports.createRestlet = createScript;

exports.createSchedule = createScript;