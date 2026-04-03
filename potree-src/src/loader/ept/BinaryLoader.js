
import * as THREE from "../../../libs/three.js/build/three.module.js";
import {XHRFactory} from "../../XHRFactory.js";

export class EptBinaryLoader {
	extension() {
		return '.bin';
	}

	workerPath() {
		return Potree.scriptPath + '/workers/EptBinaryDecoderWorker.js';
	}

	load(node) {
		if (node.loaded) return;

		let url;
		if (typeof node.url === "function") {
			url = node.url() + this.extension();
		} else {
			const { Key } = window.Copc;
			url = `${node.owner.base}/ept-data/${Key.toString(node.key)}${this.extension()}`;
		}

		let xhr = XHRFactory.createXMLHttpRequest();
		xhr.open('GET', url, true);
		xhr.responseType = 'arraybuffer';
		xhr.overrideMimeType('text/plain; charset=x-user-defined');
		xhr.onreadystatechange = () => {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					let buffer = xhr.response;
					this.parse(node, buffer);
				} else {
					console.log('Failed ' + url + ': ' + xhr.status);
				}
			}
		};

		try {
			xhr.send(null);
		}
		catch (e) {
			console.log('Failed request: ' + e);
		}
	}

	parse(node, buffer) {
		let workerPath = this.workerPath();
		let worker = Potree.workerPool.getWorker(workerPath);

		worker.onmessage = function(e) {
			let g = new THREE.BufferGeometry();
			let numPoints = e.data.numPoints;

			let position = new Float32Array(e.data.position);
			g.setAttribute('position', new THREE.BufferAttribute(position, 3));

			let indices = new Uint8Array(e.data.indices);
			g.setAttribute('indices', new THREE.BufferAttribute(indices, 4));

			if (e.data.color) {
				let color = new Uint8Array(e.data.color);
				g.setAttribute('color', new THREE.BufferAttribute(color, 4, true));
			}
			if (e.data.intensity) {
				let intensity = new Float32Array(e.data.intensity);
				g.setAttribute('intensity',
						new THREE.BufferAttribute(intensity, 1));
			}
			if (e.data.classification) {
				let classification = new Uint8Array(e.data.classification);
				g.setAttribute('classification',
						new THREE.BufferAttribute(classification, 1));
			}
			if (e.data.returnNumber) {
				let returnNumber = new Uint8Array(e.data.returnNumber);
				g.setAttribute('return number',
						new THREE.BufferAttribute(returnNumber, 1));
			}
			if (e.data.numberOfReturns) {
				let numberOfReturns = new Uint8Array(e.data.numberOfReturns);
				g.setAttribute('number of returns',
						new THREE.BufferAttribute(numberOfReturns, 1));
			}
			if (e.data.pointSourceId) {
				let pointSourceId = new Uint16Array(e.data.pointSourceId);
				g.setAttribute('source id',
						new THREE.BufferAttribute(pointSourceId, 1));
			}

			g.attributes.indices.normalized = true;

			let tightBoundingBox = new THREE.Box3(
				new THREE.Vector3().fromArray(e.data.tightBoundingBox.min),
				new THREE.Vector3().fromArray(e.data.tightBoundingBox.max)
			);

			node.doneLoading(
					g,
					tightBoundingBox,
					numPoints,
					new THREE.Vector3(...e.data.mean));

			Potree.workerPool.returnWorker(workerPath, worker);
		};

		const ept = node.ept || (node.owner && node.owner.ept);
		const schema = ept.schema || [];
		const dimByName = (name) => schema.find((d) => d && d.name === name) || {};
		const sx = dimByName("X");
		const sy = dimByName("Y");
		const sz = dimByName("Z");
		const scale = ept.eptScale || {
			x: sx.scale != null ? sx.scale : 0.001,
			y: sy.scale != null ? sy.scale : 0.001,
			z: sz.scale != null ? sz.scale : 0.001,
		};
		const offset = ept.eptOffset || {
			x: sx.offset != null ? sx.offset : 0,
			y: sy.offset != null ? sy.offset : 0,
			z: sz.offset != null ? sz.offset : 0,
		};
		const mins = (() => {
			if (node && node.key && node.key.b && node.key.b.min) {
				const v = node.key.b.min;
				return [v.x, v.y, v.z];
			}
			if (node && Array.isArray(node.bounds)) {
				return node.bounds.slice(0, 3);
			}
			return [0, 0, 0];
		})();
		let message = {
			buffer: buffer,
			schema,
			scale,
			offset,
			mins,
		};

		worker.postMessage(message, [message.buffer]);
	}
};

