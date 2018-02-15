# s3-fine-uploader
The `s3-fine-uploader` node module aims to easy the integration between `aws-s3` and [FineUploader](https://docs.fineuploader.com/) jQuery plugin.

Features of FindUpload and S3 integrated:
- Direct uploads from user's browser to S3 bucket.
- Multiple or single file uploads.
- Chunked (eg multipart) or Non-chunked uploads for large files.
- Event based progress bar, errors and status.
- Handles browser clock drift.
- Iframe support for ie9 uploads.

## Install

```bash
npm install @esscorp/s3-fine-uploader --save
```

Include `node_modules/@esscorp/s3-fine-uploader/browser/index.js` in your client side build process.

## AWS Credentials Setup

[FineUploader](https://docs.fineuploader.com/) jQuery plugin has a limitation which prevents the server from telling the browser which `accessKeyId` to use with a `signature`. When using IAM server roles EC2 instances refresh their credentials intermittently, and each instance in an app has different credentials. Therefore, FineUploader cannot use a signature created with an EC2 instances credentials. We workaround this limitation by using separate, unchanging credentials dedicated to FineUploader set in the EC2 instance environment variables.

Reference: https://github.com/FineUploader/fine-uploader/issues/1406

To setup the dedicated AWS IAM user create a custom IAM `Policy` called `CustomFineUploader` which has the following custom permissions:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "...",
            "Effect": "Allow",
            "Action": [
                "s3:AbortMultipartUpload",
                "s3:GetObject",
                "s3:ListMultipartUploadParts",
                "s3:PutObject"
            ],
            "Resource": [
                "arn:aws:s3:::my-upload-bucket/*"
            ]
        }
    ]
}
```

Note that you will need to change the SID and bucket name.

Create a dedicated AWS IAM User account and attach the `CustomFineUploader` policy to the user.

If you are not using FineUploader than you can use IAM Server Roles to mange your AWS credentials. The `aws-sdk` node module gets it's credentials from:
- **Production:** from IAM service roles. Please read the AWS documentation on AWS IAM Roles.
- **Development:** from `~/.aws/credentials` file. Please read the AWS documention on local AWS Credentials.

## AWS S3 Bucket Setup

For AWS S3 buckets which you want to support direct uploads to create a new bucket with:
- Default Properties (eg all disabled).
- Default Permissions -> Access Control List.
- Default Permissions -> Bucket Policy (eg empty).
- Custom Permissions -> CORS of 

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>DELETE</AllowedMethod>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
    <ExposeHeader>ETag</ExposeHeader>
    <AllowedHeader>content-type</AllowedHeader>
    <AllowedHeader>origin</AllowedHeader>
    <AllowedHeader>x-amz-acl</AllowedHeader>
    <AllowedHeader>x-amz-meta-qqfilename</AllowedHeader>
    <AllowedHeader>x-amz-date</AllowedHeader>
    <AllowedHeader>authorization</AllowedHeader>
</CORSRule>
</CORSConfiguration>
```

## Clock Drift

If the users computer clock drifts the user's signed upload signature will errors. Therefore, you can pass a clock drift value into the FileUploader. The clock drift value is the milliseconds difference between the server and the browser. You can use a view helper to echo the server time into the view templates or have your server controller pass in the server timestamp to the view.

## Usage

An example express app connecting to a bucket for direct upload from the user's browser.

In your Express.js app code:
```js
var S3 = require('@esscorp/s3-fine-uploader');
var signatureController = require('@esscorp/s3-fine-uploader/controller');
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
            endpoint: bucket.endpoint(),
            timeServer: Date.now()
        });
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
router.post('/signature', signatureController); // FineUpload callback to sign upload requests
router.post('/success', successController); // FineUpload callback to handle successful uploads
router.get('/ie9support', ie9supportController); // iframe support for ie9
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

	$(function() {

		var endpointS3 = '{{endpoint}}';
		var accessKey = '{{accessKeyId}}';
		var serverTime = '{{serverTime}}';

		var body = $('body');
		var btn = $('[name="file"]');
		var base = window.location.href;
		var endpointSign = base + '/signature';
		var endpointBlank = base + '/ie9support';
		var endpointSuccess = base + '/success';
		var sizeLimit = 1000 * 1000 * 20; // 20 MB
		var drift = +serverTime - Date.now();

		var uploader = new qq.s3.FineUploaderBasic({
			element: document.getElementById('uploader'),
			request: {
		        endpoint: endpointS3,
		        accessKey: accessKey,
				clockDrift: drift
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
			callbacks: new window.uploaderCallbacks(body)
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