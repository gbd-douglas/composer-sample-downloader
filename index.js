'use strict';

const BusinessNetworkDefinition = require('/Users/sstone1/git/composer/packages/composer-common').BusinessNetworkDefinition;
const RegClient = require('npm-registry-client')
const client = new RegClient();
const semver = require('semver');
const tar = require('tar');
const url = require('url');
const util = require('util');

const composerVersion = '0.9.0';

return Promise.resolve().then(() => {

    // Find all of the packages on npmjs that have:
    // 1) The keywords "composer" and "composer-network"
    // 2) The maintainer "hyperledger-ci" (officially published by "us")
    return new Promise((resolve, reject) => {
        const search = url.parse('https://registry.npmjs.org/-/v1/search');
        search.query = {
            text: 'keywords:composer,composer-network maintainer:hyperledger-ci'
        };
        const urlToGet = url.format(search);
        client.get(urlToGet, {}, (error, data, raw, res) => {
            if (error) {
                return reject(error);
            }
            resolve(data);
        });
    });

}).then((data) => {

    // For each matching package, download the short package metadata.
    return data.objects.reduce((promise, object) => {
        return promise.then((array) => {
            const urlToGet = 'https://registry.npmjs.org/' + object.package.name;
            return new Promise((resolve, reject) => {
                client.get(urlToGet, {}, (error, data, raw, res) => {
                    if (error) {
                        return reject(error);
                    }
                    array.push(data);
                    resolve(array);
                });
            });
        });
    }, Promise.resolve([]));

}).then((packages) => {

    // For each matching package (using the downloaded short package metadata) ...
    let options = [];
    packages.forEach((thePackage) => {

        // For each published version of the package ...
        const versions = Object.keys(thePackage.versions)

            // Sort in descending semantic versioning order (1.0.0, 0.1.0, 0.0.1).
            .sort(semver.rcompare)

            // Remove any prelease versions.
            // TODO: For prelease/unstable Composer versions, we might want to include these.
            .filter((version) => {
                return semver.prerelease(version) === null;
            })

            // Validate that the package.json includes a "engines" stanza that includes a
            // "composer" property, with a semantic version range of supported Composer versions.
            // Once we have validated that, use that information to check that the package is
            // supported by the current version of Composer
            .filter((version) => {
                const metadata = thePackage.versions[version];
                if (!metadata.engines) {
                    return false;
                } else if (!metadata.engines.composer ){
                    return false;
                }
                return semver.satisfies(composerVersion, metadata.engines.composer);
            });

        // If we found multiple versions of the package, we want the first (newest).
        if (versions.length) {
            const version = versions.shift();
            const metadata = thePackage.versions[version];
            options.push({
                name: metadata.name,
                description: metadata.description,
                version: metadata.version,
                tarball: metadata.dist.tarball
            });
        }

    });
    return options;

}).then((options) => {

    // This is weird - it downloads and parses the tarballs for all of the options.
    // Obviously there's a missing step for the user to pick an option :-)
    return options.reduce((promise, option) => {
        return promise.then(() => {
            console.log('Downloading', option.name, option.description, option.version, option.tarball);
            return new Promise((resolve, reject) => {

                // Download the package tarball.
                client.fetch(option.tarball, {}, (error, stream) => {
                    if (error) {
                        return reject(error);
                    }

                    // Set up a tar parser that selects BNA files.
                    const tarParse = new tar.Parse({
                        filter: (path, entry) => {
                            return path.match(/\.bna$/);
                        }
                    });

                    // Go through every entry.
                    const pipe = stream.pipe(tarParse);
                    let found = false;
                    pipe.on('entry', (entry) => {
                        console.log('Found business network archive in package', entry.path);
                        let buffer = Buffer.alloc(0);
                        entry.on('data', (data) => {

                            // Collect the data.
                            buffer = Buffer.concat([buffer, data]);

                        });
                        entry.on('end', (end) => {

                            // Parse the completed buffer.
                            BusinessNetworkDefinition.fromArchive(buffer)
                                .then((businessNetworkDefinition) => {
                                    console.log('Found business network definition', businessNetworkDefinition.getIdentifier());
                                    resolve();
                                });

                        });
                    });

                });
            });
        });
    }, Promise.resolve());

}).catch((error) => {
    console.error(error);
    process.exit(1);
});