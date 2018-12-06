#!/usr/bin/node

const fs = require('fs');
const util = require('util');
const shell = require('shelljs');
const prompt = require('enquirer');
const _ = require('lodash');
const Promise = require('bluebird');
const path = require('path');

const TMP_DIR = './tmp/';
const OUTPUT_DIR = './output/';

function execAsync(cmd, opts = {}) {
    return new Promise(function (resolve, reject) {
        // Execute the command, reject if we exit non-zero (i.e. error)
        shell.exec(cmd, opts, function (code, stdout, stderr) {
            if (code != 0) return reject(new Error(stderr));
            return resolve(stdout);
        });
    });
}

(async () => {
    const tCountRegex = /^TCOUNT:(\d+)$/;
    const cInfoRegex = /^CINFO:(\d+),\d+,"(.*)"$/;
    const tInfoRegex = /^TINFO:(\d+),(\d+),\d+,"(.*)"$/;
    const sInfoRegex = /^SINFO:(\d+),(\d+),(\d+),\d+,"(.*)"$/;

    var title = '';
    var type = '';
    var year = '';
    var tracks = [];
    var currentType = '';

    console.log('Scanning disc...');

    const infoOutput = shell.exec('makemkvcon64.exe -r info disc:0', { silent: true });
    // const infoOutput = {
    //     stdout: fs.readFileSync('./output.txt').toString(),
    // };

    const matchTCount = (line) => {
        const matches = line.match(tCountRegex);
        if (matches) {
            currentType = '';

            for (var i = 0; i < matches[1]; i++) {
                tracks.push({
                    video: {},
                    audio: [],
                    subtitles: [],
                });
            }
        }
    };

    const matchCInfo = (line) => {
        const matches = line.match(cInfoRegex);
        if (matches) {
            currentType = '';

            if (matches[1] === '1') {
                type = matches[2];
            }

            if (matches[1] === '2') {
                title = matches[2];
            }
        }
    };

    const matchTInfo = (line) => {
        const matches = line.match(tInfoRegex);
        if (matches) {
            currentType = '';

            if (matches[2] === '9') {
                tracks[parseInt(matches[1])]['length'] = matches[3];
            }
            if (matches[2] === '11') {
                tracks[parseInt(matches[1])]['size'] = matches[3];
            }
            if (matches[2] === '24') {
                tracks[parseInt(matches[1])]['trackNum'] = matches[3];
            }
            if (matches[2] === '27') {
                tracks[parseInt(matches[1])]['filename'] = matches[3];
            }
            if (matches[2] === '28') {
                tracks[parseInt(matches[1])]['lang'] = matches[3];
            }
            if (matches[2] === '30') {
                tracks[parseInt(matches[1])]['longTitle'] = matches[3];
            }
        }
    };

    const setSubTrackInfo = (trks, typ, idx, idx2, key, value) => {
        idx = parseInt(idx);
        idx2 = parseInt(idx2);

        var val = _.get(trks, `${idx}.${typ}.${idx2}`, {});
        val[key] = value;
        trks[idx][typ][idx2] = val;

        return trks;
    };

    const matchSInfo = (line) => {
        const matches = line.match(sInfoRegex);
        if (matches) {
            if (matches[3] === '1') {
                currentType = matches[4];
            }

            if (currentType === 'Video') {
                if (matches[3] === '19') {
                    tracks[parseInt(matches[1])]['video']['resolution'] = matches[4];
                }

                if (matches[3] === '28') {
                    tracks[parseInt(matches[1])]['video']['lang'] = matches[4];
                }
            }

            if (currentType === 'Audio') {
                if (matches[3] === '30') {
                    tracks = setSubTrackInfo(tracks, 'audio', parseInt(matches[1]), parseInt(matches[2]), 'type', matches[4]);
                }

                if (matches[3] === '3') {
                    tracks = setSubTrackInfo(tracks, 'audio', parseInt(matches[1]), parseInt(matches[2]), 'lang', matches[4]);
                }
            }

            if (currentType === 'Subtitles') {
                if (matches[3] === '3') {
                    tracks = setSubTrackInfo(tracks, 'subtitles', parseInt(matches[1]), parseInt(matches[2]), 'lang', matches[4]);
                }

                if (matches[3] === '4') {
                    tracks = setSubTrackInfo(tracks, 'subtitles', parseInt(matches[1]), parseInt(matches[2]), 'longLang', matches[4]);
                }

                if (matches[3] === '5') {
                    tracks = setSubTrackInfo(tracks, 'subtitles', parseInt(matches[1]), parseInt(matches[2]), 'type', matches[4]);
                }
            }
        }
    };

    infoOutput.stdout.split("\n").forEach(line => {
        line = line.trim();

        matchTCount(line);
        matchCInfo(line);
        matchTInfo(line);
        matchSInfo(line);
    });

    // console.log(JSON.stringify(tracks));
    // process.exit(0);

    const titleResult = await new prompt.Form({
        name: 'title',
        message: 'Set name and year for disc',
        choices: [
            {
                name: 'title',
                message: 'Title',
                initial: title,
            },
            {
                name: 'year',
                message: 'Year',
            },
        ],
    }).run();

    title = titleResult.title;
    year = titleResult.year;

    const selector = new prompt.MultiSelect({
        name: 'tracks',
        message: 'Choose your tracks',
        result: (ans) => {
            return Object.keys(
                Object.assign(
                    {},
                    ...function _flatten(o) {
                        return [].concat(
                            ...Object.keys(o).map(
                                k => typeof o[k] === 'object' ? _flatten(o[k]) : ({[k]: o[k]})
                            )
                        )
                    }(ans),
                )
            );
        },
        initial: [
            '0-video',
            '0-audio-1', // TODO: Figure out how to calculate me
        ],
        choices: [
            ...tracks.map((i, idx) => {
                return {
                    message: i.longTitle.replace(/\./g, '_'),
                    name: `${idx}-track`,
                    role: 'heading',
                    choices: [
                        {
                            name: `${idx}-video`,
                            message: 'video',
                        },
                        {
                            name: 'audio',
                            role: 'heading',
                            choices: i.audio.map((j, jidx) => {
                                if (j) {
                                    return {
                                        message: `Audio: ${j.type}`.replace(/\./g, '_'),
                                        name: `${idx}-audio-${jidx}`,
                                    };
                                }
                            }).filter(e => !!e),
                        },
                        {
                            name: 'subtitles',
                            role: 'heading',
                            choices: i.subtitles.map((s, sidx) => {
                                if (s) {
                                    return {
                                        message: `Subtitle: ${s.longLang} (${s.type})`.replace(/\./g, '_'),
                                        name: `${idx}-subtitles-${sidx}`,
                                    };
                                }
                            }).filter(e => !!e),
                        },
                    ],
                };
            })
        ],
    });

    const answer = await selector.run();
    const videoFiles = answer.filter(a => a.includes('-video'));

    // Do the ripping to mkv first
    const ripResult = await Promise.map(videoFiles, async (a) => {
        const [ idx, _ ] = a.split('-');
        const command = `makemkvcon64.exe mkv disc:0 ${idx} ${TMP_DIR}`;
        console.log(a, command);
        return await execAsync(command, { silent:true });
    }, { concurrency: 1 });

    // Get list of filenames to work with after ripping
    // Since makemkv just writes out weird filenames based on the title and what it
    // thinks the track should be...  it does match up with our index though.
    // Maybe we can strip them out of the output of makemkv instead at some point...
    const filenames = shell.ls(TMP_DIR).filter(e => e.endsWith('.mkv'));

    console.log('Detecting crop...');

    const cropValues = await Promise.map(filenames, async (filename) => {
        const cropResult = shell.exec(`detect-crop "${path.join(TMP_DIR, filename)}" | grep "transcode-video"`, { silent:true });
        const regex = /(\d+:\d+:\d+:\d+)/;

        const foundCropValues = cropResult.stdout.split("\n").filter(e => !!e).map(line => {
            const matches = line.match(regex);
            if (matches) {
                return matches[1];
            }
        });

        if (foundCropValues.length > 1) {
            return await new prompt.Select({
                message: `${filename} has multiple crop values. Select one:`,
                choices: foundCropValues,
            }).run();
        } else {
            return foundCropValues[0];
        }
    });

    console.log('Starting transcode...');

    const transcodeResult = await Promise.map(filenames, async (filename, fileidx) => {
        const inputFilename = path.join(TMP_DIR, filename);
        console.log('transcoding...', inputFilename);
        const command = `transcode-video --quick --target small --mp4 --crop ${cropValues[fileidx]} --burn-subtitle scan -o "${TMP_DIR}" "${inputFilename}"`;
        return await execAsync(command, { silent:true })
    }, { concurrency: 1 });

    console.log('Moving files...');

    // console.log('result', result);
    const moveResult = await Promise.map(filenames, (filename, fileidx) => {
        const transcodedFilename = filename.replace('.mkv', '.mp4');
        const oldLocation = path.join(TMP_DIR, transcodedFilename);
        const newTitle = `${title} (${year})`;
        let newFilename = `${newTitle}.mp4`;
        if (fileidx > 0) {
            newFilename = `${newTitle} Extra ${fileidx}.mp4`;
        }
        const newLocation = path.join(OUTPUT_DIR, newTitle, newFilename);
        shell.mkdir('-p', path.join(OUTPUT_DIR, newTitle));

        console.log('Moving file', oldLocation, newLocation);
        return Promise.resolve(shell.mv(oldLocation, newLocation));
    }, { concurrency: 1 });

    // console.log(moveResult);

    console.log('Finished');

})();
