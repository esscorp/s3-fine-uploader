# s3-fine-uploader
The `s3-fine-uploader` node module aims to easy the integration between `aws-s3` and [FineUploader](https://docs.fineuploader.com/) jQuery plugin. This integration supports:

- Direct uploads from user's browser to S3 bucket.
- Multiple or single file uploads.
- Chunked (eg multipart) or Non-chunked uploads for large files.
- Event based progress bar, errors and status.
- Handles clock drift between user's computer and app server.


## Install

```bash
npm install @esscorp/s3-fine-uploader --save
```

## AWS Credentials Setup

[FineUploader](https://docs.fineuploader.com/) jQuery plugin has a limitation which prevents the server from telling the browser which `accessKeyId` to use with a `signature`. When using IAM server roles EC2 instances refresh their credentials intermittently, and each instance in an app has different credentials. Therefore, FineUploader cannot use a signature created with an EC2 instances credentials. We workaround this limitation by using separate, unchanging credentials dedicated to FineUploader set in the EC2 instance environment variables.

Reference: https://github.com/FineUploader/fine-uploader/issues/1406

If you are not using FineUploader than you can use IAM server roles to mange your AWS credentials. The `aws-sdk` node module gets it's credentials from:
- ** Production:** from IAM service roles. Please read the AWS documentation on AWS IAM Roles.
- ** Development: from `~/.aws/credentials` file. Please read the AWS documention on local AWS Credentials.

## AWS S3 Setup

todo: document this

## Clock Drift

If the users computer clock drifts or is just plain wrong the user's signed upload signature will cause errors.  Therefore, we create a view helper which echos the server Unix millisecond timestamp (eg 1360013296123) which is passed into the FineUploader. This means the FineUploader and your server share the same time.

```js
//Unix millisecond timestamp (eg 1360013296123)
exports.clockDrift = function() {
	return Moment().format('x');
};
```

## Usage

An example express app connecting to a bucket for direct upload from the user's browser.

```js
var S3 = require('@esscorp/s3-fine-uploader');
var bucket = new S3({
	bucket: 'my-upload-bucket',
	expires: 60 * 60, // 1 hour
	minSize: null,
	maxSize: null,
	iam: {
		region: 'us-east-1',
		apiVersion: '2006-03-01'
		accessKeyId: process.env.AWS_APP_UPLOADER_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_APP_UPLOADER_SECRET_ACCESS_KEY
	}
});

// Controller to show the upload form.
var uploadController = function(req, res, next) {
	bucket.getAccessKeyId(function(err, accessKeyId) {
        if (err) next(err);

		res.render('views/upload', {
            accessKeyId: accessKeyId,
            endpoint: bucket.endpoint()
        });
	});
};

// Controller to handle the signature requests from FineUploader.
// For multipart uploads this controller gets called for every part.
var signatureController = function(req, res, next) {
    var policy = req.body;
    var isChunked = !!req.body.headers;
	var sign = (isChunked)
		? _chunked // multipart (chunked) request
		: _nonChunked; // simple (non-chunked) request
	return sign(req, res, next);
};

var _chunked = function(req, res, next) {

	var policy = req.body;
	var version = req.query.v4 ? 4 : 2;
	var stringToSign = policy.headers;
	var sign = (version === 4)
		? bucket.signV4RestRequest
		: bucket.signV2RestRequest;

	sign(stringToSign, function(err, signature) {
		if (err) return next(err);

		var jsonResponse = {signature: signature};

		res.setHeader('Content-Type', 'application/json');

		if (bucket.isValidRestRequest(stringToSign, version)) {
			res.json(jsonResponse);
		} else {
			next(new Error('Invalid chunked request'));
		}
	});
};

var _nonChunked = function(req, res, next) {

	var policy = req.body;
	var isV4 = !!req.query.v4;
	var base64Policy = new Buffer(JSON.stringify(policy)).toString('base64');
	var sign = (isV4)
		? bucket.signV4Policy
		: bucket.signV2Policy;

	sign(policy, base64Policy, function(err, signature) {
		if (err) return next(err);

		var jsonResponse = {
			policy: base64Policy,
			signature: signature
		};

		res.setHeader('Content-Type', 'application/json');

		if (bucket.isPolicyValid(policy)) {
			res.json(jsonResponse);
		} else {
			next(new Error('Invalid non-chunked request'));
		}
	});
};

// Controller to handle the success callback from FineUploader
// after a successful direct upload to S3.
var successController = function(req, res, next) {

	var key = req.body.key;
	var uuid = req.body.uuid;
	var name = req.body.name;
	var kind = key.substring(37).toUpperCase();

    bucket.verifyUpload(key, function(err, verified) {
		if (err) return next(err);
		if (!verified) return next(new Error('S3 file is invalid'));

		// do something with the fact that you now have a verified file uploaded to S3.
	});
};

var ie9support = function(req, res) {
	res.render('views/ie9support');
};

// Wire up controllers to express router
var express = require('express');
var router = express.Router();
router.get('/upload', uploadController); // show upload form
router.post('/signature', signatureController); // sign upload requests
router.post('/success', successController); // handle successful uploads
router.get('/ie9support', ie9supportController); // show ie9 sucks
```

The `views/upload.hbs` template:
```html

<!-- if you are using the fineuploader S3 and UI
<link href="/libs/fineuploader/fine-uploader-gallery.min.css" rel="stylesheet">
<script src="/libs/fineuploader/s3.fine-uploader.min.js"></script>
-->

<!-- if you are using the fineuploader S3 with no UI -->
<script src="/libs/fineuploader/s3.fine-uploader.core.min.js"></script>
<script type="text/javascript">

    function uploaderCallbacks(div) {

        function acceptableMime(file, name) { // eslint-disable-line no-unused-vars
            var mime = (file && file.type)? file.type : false;
            var mimes = ['image/jpeg', 'image/gif', 'image/png', 'image/bmp', 'image/tiff', 'application/pdf'];
            var accepted = ($.inArray(mime, mimes) >= 0);
            return accepted;
        }

        function acceptableExt(file, name) {

            var ext = name.substring(name.indexOf('.') + 1).toLowerCase();
            var exts = ['jpeg', 'jpg', 'gif', 'png', 'bmp', 'tiff', 'pdf'];
            var accepted = ($.inArray(ext, exts) >= 0);
            return accepted;
        }

        // some browsers will not support File API and
        // therefore the acceptableMime() will fail
        function acceptable(file, name) {

            var acceptedExt = acceptableExt(file, name);
            var acceptedMime = acceptableMime(file, name);

            if (acceptedMime) return true;
            if (acceptedExt) return true;
            return false;
        }

        function onSubmit(id, name) {
            var uuid = this.getUuid(id);
            var file = this.getFile(id);
            var accepted = acceptable(file, name);
            var trigger = (accepted)? 'upload.accept' : 'upload.reject';

            //console.log('onSubmit()', accepted);

            div.trigger(trigger, {
                uuid: uuid,
                name: name
            });
            return accepted;
        }

        function onSubmitted(id, name) {
            var uuid = this.getUuid(id);
            //console.log('onSubmitted()', uuid);
            div.trigger('upload.start', {
                uuid: uuid,
                name: name
            });
        }

        function onProgress(id, name, uploadedBytes, totalBytes) {
            var uuid = this.getUuid(id);
            //console.log('onProgress()', uuid);
            div.trigger('upload.progress', {
                uuid: uuid,
                progress: uploadedBytes / totalBytes
            });
        }

        function onTotalProgress(uploadedBytes, totalBytes) {
            //console.log('onProgress()', uuid);
            div.trigger('upload.all.progress', {
                progress: uploadedBytes / totalBytes
            });
        }

        // onError is called on all upload errors. In particular,
        // when fineuploader validation fails the `this.getUuid(id)`
        // throws an error if id is undefined.
        function onError(id, name, reason, xhr) { // eslint-disable-line no-unused-vars

            //console.log('onError()', id, name, reason);

            // if you cancel on second upload, eat this error
            if (reason === 'No files to upload.') return;

            var data = {
                reason: reason
            };
            if (id) data.id = id;
            if (id) data.uuid = this.getUuid(id);
            if (id) data.name = name;

            div.trigger('upload.error', data);
        }

        function onComplete(id, name, json, xhr) { // eslint-disable-line no-unused-vars
            //var uuid = json.uuid;
            //console.log('onComplete()', uuid);
            div.trigger('upload.complete', json);
        }

        function onAllComplete(succeeded, failed) {
            div.trigger('upload.all.complete', {
                succeeded: succeeded || [],
                failed: failed || []
            });
        }

        return {
            onSubmit: onSubmit,
            onSubmitted: onSubmitted,
            onProgress: onProgress,
            onTotalProgress: onTotalProgress,
            onError: onError,
            onComplete: onComplete,
            onAllComplete: onAllComplete
        };
    };

	$(function() {

		var btn = $('[name="file"]');
		var body = $('body');
		var base = window.location.href;
		var bucket = '{{endpoint}}';
		var endpointSign = base + '/signature';
		var endpointBlank = base + '/ie9support';
		var endpointSuccess = base + '/success';
		var sizeLimit = 1000 * 1000 * 20; // 20 MB

		var accessKey = '{{accessKeyId}}';

		var uploader = new qq.s3.FineUploaderBasic({
			element: document.getElementById('uploader'),
			request: {
		        endpoint: bucket,
		        accessKey: accessKey,
				clockDrift: {{clockDrift}} - Date.now()
		    },
		    signature: {
		        endpoint: endpointSign
		    },
		    uploadSuccess: {
		        endpoint: endpointSuccess
		    },
		    iframeSupport: {
		        localBlankPagePath: endpointBlank
		    },
			validation: {
				allowEmpty: false,
				sizeLimit: sizeLimit,
				image: {
					maxHeight: 10000,
					maxWidth: 10000,
					minHeight: 100,
					minWidth: 100
				}
			},
			callbacks: new uploaderCallbacks(body)
		});

		btn.change(function() {
			uploader.addFiles(this);
		});
	});
</script>


<p>Press the button below to choose your files to upload. We support image types of .pdf, .jpg, .jpeg, .png, .tiff, and .gif.</p>

<div id="uploader"></div>

<div class="form-group">
	<div class="col-sm-offset-2 col-sm-8">
		<div class="input-group">
			<label class="input-group-btn" for="file">
				<span class="btn btn-primary btn-file">
					<i class="fa fa-cloud-upload fa-lg" aria-hidden="true"></i> Choose File...
					<input id="file" type="file" name="file" accept="image/jpeg,image/gif,image/png,application/pdf,image/tiff" multiple>
				</span>
			</label>
		</div>
	</div>
</div>

<!-- express partial progress bar -->
{{> progressbar }}
```

The `progressbar.hbs` template:
```html
<script type="text/javascript">
	$(function() {

		var body = $('body');
		var progress = $('div.progress');
		var bar = progress.find('div.progress-bar');
		var originalClasses = bar.attr('class');

		function stringify(json){
			if (!JSON) {
				return 'no JSON support.';
			} else if (!JSON.stringify) {
				return 'no stringify support.';
			} else if (!json){
				return 'no data to stringify.'
			} else {
				return JSON.stringify(json);
			}
		}

		progress.on('progress.clear', function(event) {
			progress.trigger('progress.update', 0);
			bar.attr('class', originalClasses);
		});

		progress.on('progress.show', function(event) {
			progress.show();
		});

		progress.on('progress.activate', function(event) {
			bar.addClass('active');
		});

		progress.on('progress.update', function(event, percent) {
			bar.attr('aria-valuenow', percent);
			bar.css('width', percent + '%');
			bar.text(percent + '%');
		});

		progress.on('progress.done', function(event) {
			progress.trigger('progress.update', 100);
			bar.removeClass('active');
			bar.removeClass('progress-bar-striped');
			bar.addClass('progress-bar-success');
		});

		progress.on('progress.fail', function(event) {
			bar.removeClass('active');
			bar.removeClass('progress-bar-striped');
			bar.addClass('progress-bar-danger');
		});

		progress.on('progress.hide', function(event, delay) {
			delay = +delay || 0;
			setTimeout(function() {
				progress.fadeOut();
			}, delay);
		});

		// ***** upload events *****
		body.on('upload.reject', function(e, data) {
			var message = 'upload.reject: ' + stringify(data);
			trackJs.track(message);
			$('#alert-upload-reject').show();
			$('#alert-upload-error').hide();
			$('#alert-upload-success').hide();
		});

		/*
			You can simulate an upload error by setting
			an invalid time (greater than bucket expires time )
			on your computer. You will also need to disable the
			the clock drift.
		*/
		body.on('upload.error', function(e, data) {
			var message = 'upload.error: ' + stringify(data);
			trackJs.track(message);
			//console.log('upload.error', data);

			$('#alert-upload-error').show();
			$('#alert-upload-reject').hide();
			$('#alert-upload-success').hide();
			progress.trigger('progress.hide', 0);
			$('.error-reason').html(data.reason);
		});

		body.on('upload.start', function() {

			$('#alert-upload-reject').hide();
			$('#alert-upload-error').hide();

			progress.trigger('progress.clear');
			progress.trigger('progress.show');
		});

		body.on('upload.all.progress', function(e, data) {
			var pct = (data.progress * 100).toFixed(0);
			progress.trigger('progress.update', pct);
		});

		body.on('upload.all.complete', function(e, data) {

			//seems like finduploader is merging
			// 'onComplete', 'onAllComplete' and 'onError' events
			if (data.error) return; // ignore `onError` events
			if (data.id) return; // ignore 'onComplete' events

			// only as a precaution make sure these are set
			data.succeeded = data.succeeded || [];
			data.failed = data.failed || [];

			//console.log('upload.all.complete', data);

			if (data.success || !!data.succeeded.length) {
				progress.trigger('progress.done');
				progress.trigger('progress.hide', 2000);

				$('#alert-upload-success').show();
				$('.btn-file').removeClass('btn-primary');
				$('.btn-file').addClass('btn-default');
			}
		});
	});
</script>

<div class="form-group">
	<div class="col-sm-offset-2 col-sm-8 m-t-7">
		<div class="progress" style="display: none;">
			<div class="progress-bar progress-bar-striped" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%; min-width: 2em;">
				0%
			</div>
		</div>

		<div id="alert-upload-reject" class="alert alert-warning" style="display: none;">
			<p><i class="fa fa-info-circle" aria-hidden="true"></i> One of the files you are attempting to upload is not supported. <strong><span class="error-reason"></span></strong></p>
		</div>

		<div id="alert-upload-error" class="alert alert-danger" style="display: none;">
			<p><i class="fa fa-info-circle" aria-hidden="true"></i> One of the files you are attempting to upload has errored. <strong><span class="error-reason"></span></strong></p>
		</div>

		<div id="alert-upload-success" class="alert alert-info" style="display: none;">
			<p><i class="fa fa-info-circle" aria-hidden="true"></i> Your file was successfully uploaded.</p>
		</div>
	</div>
</div>
```