function TestHook(GlobRunner,RemoteRunner,SyncedFileCollection,S3PromiseWrapper,AWS,fileUtils){
GlobRunner = GlobRunner || require('./GlobRunner.js');
RemoteRunner = RemoteRunner || require('./RemoteRunner.js');
SyncedFileCollection = SyncedFileCollection || require('./SyncedFileCollection.js');
S3PromiseWrapper = S3PromiseWrapper || require('./S3PromiseWrapper.js');
fileUtils = fileUtils || require('./file-utils.js');
AWS = AWS || require('aws-sdk');
var S3 = AWS.S3;

if (process.env.DELETE_EXPIRATION) {
    try {
        process.env.DELETE_EXPIRATION = parseInt(process.env.DELETE_EXPIRATION, 10);
    } catch (e) {}
}

var reallyDeleteExpiration = process.env.DELETE_EXPIRATION || 7 * 24 * 60 * 60 * 1000;

return function ConfigRunner(){
    var config;

    this.setConfig = function(conf){
        config = conf;
        return this;
    };

    this.run = function(){

        config.credentials && AWS.config.loadFromPath(config.credentials);

        var s3 = new S3();
        var s3Wrapper = new S3PromiseWrapper(s3);

        var collection = new SyncedFileCollection();
        var globRunner = new GlobRunner(collection);
        var remoteRunner = new RemoteRunner(config.bucketName,collection,s3Wrapper);

        var patterns = config.patterns;

        for(var i = 0; i < patterns.length; i ++){
            globRunner.addPattern(patterns[i]);
        }

        //   config.patterns.forEach(globRunner.addPattern);

        remoteRunner.run();
        globRunner.run();

        collection.allDone.then(function(actions){
            var deletes = [];
            actions.forEach(function(obj){
                switch(obj.action){
                    case 'delete':
                        deletes.push(obj);
                        break;
                    case 'upload':
                        console.log('should upload: ' + obj.path);
                        fileUtils.getContents(obj.path).then(function(contents){
                            console.log('uploading: ' + obj.path);
                            s3Wrapper.putObject(config.bucketName,obj.path,contents).then(function(){
                                console.log('done uploading: ' + obj.path);
                            },function(reason){
                                console.log('error uploading: ' + obj.path);
                                console.log(reason);
                                process.exit(1);
                            });
                        });
                }
            });
            if(deletes.length !== 0) {

                var dates = [1558941400000];
                deletes.forEach(function (toDel) {
                  if ((/\.(js|css|png)$/i).test(toDel.path)) {
                    var millis = toDel.lastModified.setSeconds(0);
                    if (dates.indexOf(millis) < 0) {
                      dates.push(millis);
                    }
                  }
                });

                if (dates.length === 1) {
                  console.log('SKIP deleteing the following: ');
                  deletes.forEach(function(d){console.log('\t' + d.path)});
                  return;
                }

                dates.sort(function(a, b) {
                  return a - b;
                });

                var justRemove = dates.shift();
                var skip = [];

                var reallyDelete = [];
                deletes.forEach(function (toDel) {
                  var millis = toDel.lastModified.setSeconds(0);
                  if (dates.indexOf(millis) >= 0 && (millis + (reallyDeleteExpiration) < Date.now())) {
                    reallyDelete.push(toDel);
                  } else {
                    skip.push(toDel);
                  }
                });

                if (skip.length > 0) {
                  console.log('SKIP deleteing the following (because of age): ');
                  skip.forEach(function(d){console.log('\t' + d.path)});
                }

                deletes = reallyDelete.map(function (d) {
                  return d.path;
                });

                if (deletes.length === 0) {
                  console.log('nothing to delete!');
                  return;
                }

                console.log('deleting the following: ');
                deletes.forEach(function(path){console.log('\t' + path)});
                s3Wrapper.deleteObjects(config.bucketName,deletes).then(
                    function(){console.log('delete successful')},
                    function(reason){console.log('delete failed ' + reason); console.log(reason); process.exit(1); });
            }
        });

    };
};
}

var ConfigRunner = TestHook();
ConfigRunner.TestHook = TestHook;

module.exports = ConfigRunner;
