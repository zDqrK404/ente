import { File, getLocalFiles } from 'services/fileService';
import DownloadManager from 'services/downloadManager';

import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-wasm';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import '@tensorflow/tfjs-backend-cpu';

import TFJSFaceDetectionService from './tfjsFaceDetectionService';
import TFJSFaceEmbeddingService from './tfjsFaceEmbeddingService';
import {
    Face,
    FaceAlignmentService,
    FaceDetectionService,
    FaceEmbeddingService,
    MlFileData,
    MLSyncConfig,
    MLSyncContext,
    MLSyncResult,
} from 'utils/machineLearning/types';

import * as jpeg from 'jpeg-js';
import ClusteringService from './clusteringService';

import { toTSNE } from 'utils/machineLearning/visualization';
import { mlFilesStore } from 'utils/storage/localForage';
import ArcfaceAlignmentService from './arcfaceAlignmentService';

class MachineLearningService {
    private faceDetectionService: FaceDetectionService;
    // private faceLandmarkService: FAPIFaceLandmarksService;
    private faceAlignmentService: FaceAlignmentService;
    private faceEmbeddingService: FaceEmbeddingService;
    // private faceEmbeddingService: FAPIFaceEmbeddingService;
    private clusteringService: ClusteringService;

    public constructor() {
        setWasmPaths('/js/tfjs/');

        this.faceDetectionService = new TFJSFaceDetectionService();
        // this.faceLandmarkService = new FAPIFaceLandmarksService();
        this.faceAlignmentService = new ArcfaceAlignmentService();
        this.faceEmbeddingService = new TFJSFaceEmbeddingService();
        // this.faceEmbeddingService = new FAPIFaceEmbeddingService();
        this.clusteringService = new ClusteringService();
    }

    public async sync(
        token: string,
        config: MLSyncConfig
    ): Promise<MLSyncResult> {
        if (!token) {
            throw Error('Token needed by ml service to sync file');
        }

        const syncContext = new MLSyncContext(token, config);

        await this.getOutOfSyncFiles(syncContext);

        if (syncContext.outOfSyncFiles.length > 0) {
            await this.syncFiles(syncContext);
        } else {
            await this.syncIndex(syncContext);
        }

        console.log('Final TF Memory stats: ', tf.memory());

        if (syncContext.config.tsne) {
            await this.runTSNE(syncContext);
        }

        const mlSyncResult: MLSyncResult = {
            nOutOfSyncFiles: syncContext.outOfSyncFiles.length,
            nSyncedFiles: syncContext.syncedFiles.length,
            nSyncedFaces: syncContext.syncedFaces.length,
            nFaceClusters: syncContext.faceClustersWithNoise?.clusters.length,
            nFaceNoise: syncContext.faceClustersWithNoise?.noise.length,
            tsne: syncContext.tsne,
        };
        console.log('[MLService] sync results: ', mlSyncResult);

        return mlSyncResult;
    }

    private async getMLFileVersion(file: File) {
        const mlFileData: MlFileData = await mlFilesStore.getItem(
            file.id.toString()
        );
        return mlFileData && mlFileData.mlVersion;
    }

    private async getUniqueOutOfSyncFiles(
        syncContext: MLSyncContext,
        files: File[]
    ) {
        const limit = syncContext.config.batchSize;
        const mlVersion = syncContext.config.mlVersion;
        const uniqueFiles: Map<number, File> = new Map<number, File>();
        for (let i = 0; uniqueFiles.size < limit && i < files.length; i++) {
            const mlFileVersion = (await this.getMLFileVersion(files[i])) || 0;
            if (!uniqueFiles.has(files[i].id) && mlFileVersion < mlVersion) {
                uniqueFiles.set(files[i].id, files[i]);
            }
        }

        return [...uniqueFiles.values()];
    }

    private async getOutOfSyncFiles(syncContext: MLSyncContext) {
        const existingFiles = await getLocalFiles();
        existingFiles.sort(
            (a, b) => b.metadata.creationTime - a.metadata.creationTime
        );
        syncContext.outOfSyncFiles = await this.getUniqueOutOfSyncFiles(
            syncContext,
            existingFiles
        );
        console.log(
            'Got unique outOfSyncFiles: ',
            syncContext.outOfSyncFiles.length,
            'for batchSize: ',
            syncContext.config.batchSize
        );
    }

    private async syncFiles(syncContext: MLSyncContext) {
        // await this.initMLModels();

        for (const outOfSyncfile of syncContext.outOfSyncFiles) {
            try {
                const mlFileData = await this.syncFile(
                    syncContext,
                    outOfSyncfile
                );
                mlFileData.faces &&
                    syncContext.syncedFaces.push(...mlFileData.faces);
                syncContext.syncedFiles.push(outOfSyncfile);
                console.log('TF Memory stats: ', tf.memory());
            } catch (e) {
                console.error(
                    'Error while syncing file: ',
                    outOfSyncfile.id.toString(),
                    e
                );
            }
        }
        console.log('allFaces: ', syncContext.syncedFaces);
        // await this.disposeMLModels();
    }

    private async syncFile(syncContext: MLSyncContext, file: File) {
        const mlFileData: MlFileData = {
            fileId: file.id,
            mlVersion: syncContext.config.mlVersion,
        };
        const fileUrl = await DownloadManager.getPreview(
            file,
            syncContext.token
        );
        console.log('[MLService] Got thumbnail: ', file.id.toString(), fileUrl);

        const thumbFile = await fetch(fileUrl);
        const arrayBuffer = await thumbFile.arrayBuffer();
        const decodedImg = await jpeg.decode(arrayBuffer);
        console.log('[MLService] decodedImg: ', decodedImg);

        // console.log('1 TF Memory stats: ', tf.memory());
        const tfImage = tf.browser.fromPixels(decodedImg);
        // console.log('2 TF Memory stats: ', tf.memory());
        const detectedFaces = await this.faceDetectionService.detectFaces(
            tfImage
        );

        const filtertedFaces = detectedFaces.filter(
            (f) => f.box.width > syncContext.config.faceDetection.minFaceSize
        );
        console.log('[MLService] filtertedFaces: ', filtertedFaces);
        if (filtertedFaces.length < 1) {
            await this.persistMLFileData(syncContext, mlFileData);
            return mlFileData;
        }

        const alignedFaces =
            this.faceAlignmentService.getAlignedFaces(filtertedFaces);
        console.log('[MLService] alignedFaces: ', alignedFaces);
        // console.log('3 TF Memory stats: ', tf.memory());

        const facesWithEmbeddings =
            await this.faceEmbeddingService.getFaceEmbeddings(
                tfImage,
                alignedFaces
            );
        console.log('[MLService] facesWithEmbeddings: ', facesWithEmbeddings);
        // console.log('4 TF Memory stats: ', tf.memory());

        tf.dispose(tfImage);
        // console.log('8 TF Memory stats: ', tf.memory());

        const faces = facesWithEmbeddings.map(
            (faceWithEmbeddings) =>
                ({
                    fileId: file.id,

                    ...faceWithEmbeddings,
                } as Face)
        );

        mlFileData.faces = faces;
        await this.persistMLFileData(syncContext, mlFileData);

        return mlFileData;
    }

    public async init() {
        await tf.ready();

        console.log('01 TF Memory stats: ', tf.memory());
        await this.faceDetectionService.init();
        // // console.log('02 TF Memory stats: ', tf.memory());
        // await this.faceLandmarkService.init();
        // await faceapi.nets.faceLandmark68Net.loadFromUri('/models/face-api/');
        // // console.log('03 TF Memory stats: ', tf.memory());
        await this.faceEmbeddingService.init();
        // await faceapi.nets.faceRecognitionNet.loadFromUri('/models/face-api/');
        console.log('04 TF Memory stats: ', tf.memory());
    }

    public async dispose() {
        await this.faceDetectionService.dispose();
        // console.log('11 TF Memory stats: ', tf.memory());
        // await this.faceLandmarkService.dispose();
        // console.log('12 TF Memory stats: ', tf.memory());
        await this.faceEmbeddingService.dispose();
        // console.log('13 TF Memory stats: ', tf.memory());
    }

    private async persistMLFileData(
        syncContext: MLSyncContext,
        mlFileData: MlFileData
    ) {
        return mlFilesStore.setItem(mlFileData.fileId.toString(), mlFileData);
    }

    public async syncIndex(syncContext: MLSyncContext) {
        await this.runFaceClustering(syncContext);
    }

    private async getAllFaces(syncContext: MLSyncContext) {
        if (syncContext.allSyncedFaces) {
            return syncContext.allSyncedFaces;
        }

        const allFaces: Array<Face> = [];
        await mlFilesStore.iterate((mlFileData: MlFileData) => {
            mlFileData.faces && allFaces.push(...mlFileData.faces);
        });

        syncContext.allSyncedFaces = allFaces;
        return allFaces;
    }

    public async runFaceClustering(syncContext: MLSyncContext) {
        const clusteringConfig =
            syncContext.config.faceClustering.clusteringConfig;
        const allFaces = await this.getAllFaces(syncContext);

        if (!allFaces || allFaces.length < clusteringConfig.minInputSize) {
            console.log(
                'Too few faces to cluster, not running clustering: ',
                allFaces.length
            );
            return;
        }

        console.log('Running clustering allFaces: ', allFaces.length);
        syncContext.faceClusteringResults = this.clusteringService.cluster(
            syncContext.config.faceClustering.method,
            allFaces.map((f) => Array.from(f.embedding)),
            syncContext.config.faceClustering.clusteringConfig
        );
        console.log(
            '[MLService] Got face clustering results: ',
            syncContext.faceClusteringResults
        );

        syncContext.faceClustersWithNoise = {
            clusters: syncContext.faceClusteringResults.clusters.map(
                (faces) => ({
                    faces,
                })
            ),
            noise: syncContext.faceClusteringResults.noise,
        };
    }

    private async runTSNE(syncContext: MLSyncContext) {
        let faces = syncContext.syncedFaces;
        if (!faces || faces.length < 1) {
            faces = await this.getAllFaces(syncContext);
        }

        const input = faces
            .slice(0, syncContext.config.tsne.samples)
            .map((f) => f.embedding);
        syncContext.tsne = toTSNE(input, syncContext.config.tsne);
        console.log('tsne: ', syncContext.tsne);
    }
}

export default MachineLearningService;
