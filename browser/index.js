window.uploaderCallbacks = function(div) {

	function acceptableMime(file, name) { // eslint-disable-line no-unused-vars
		var mime = (file && file.type) ? file.type : false;
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
		var trigger = (accepted) ? 'upload.accept' : 'upload.reject';

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
