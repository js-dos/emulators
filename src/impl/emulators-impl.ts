import { Build } from "../build";
import { Emulators, CommandInterface } from "../emulators";
import { Cache, CacheDb } from "../cache";

import { IWasmModules, WasmModulesImpl } from "./modules";

import DosBundle from "../dos/bundle/dos-bundle";
import { dosDirect } from "../dos/dosbox/ts/direct";
import { dosWorker } from "../dos/dosbox/ts/worker";
import Janus from "../janus/janus-impl";

import { TransportLayer, CommandInterfaceOverTransportLayer } from "../protocol/protocol";

class EmulatorsImpl implements Emulators {
    pathPrefix = "";
    wdosboxJs = (typeof window !== "undefined" &&
     (window as any).crossOriginIsolated === true) ? "wdosbox.shared.js" : "wdosbox.js";
    cacheSeed = "";

    private cachePromises: {[cacheName: string]: Promise<Cache>} = {};
    private wasmModulesPromise?: Promise<IWasmModules>;

    cache(cacheName?: string): Promise<Cache> {
        if (cacheName === undefined || cacheName === null || cacheName.length === 0) {
            cacheName = Build.version + " " + this.cacheSeed;
        }

        const cachePromise = this.cachePromises[cacheName];

        if (cachePromise === undefined) {
            const promise = CacheDb(cacheName, {
                onErr: console.error,
            });

            this.cachePromises[cacheName] = promise;
        }

        return this.cachePromises[cacheName];
    }

    async dosBundle(): Promise<DosBundle> {
        const modules = await this.wasmModules();
        const libzipWasm = await modules.libzip();
        const cache = await this.cache();
        return new DosBundle(libzipWasm, cache);
    }

    async dosboxNode(bundle: Uint8Array | Uint8Array[]): Promise<CommandInterface> {
        return this.dosboxDirect(bundle);
    }

    async dosboxDirect(bundle: Uint8Array | Uint8Array[]): Promise<CommandInterface> {
        const modules = await this.wasmModules();
        const dosboxWasm = await modules.dosbox();
        const transportLayer = await dosDirect(dosboxWasm, "session-" + Date.now());
        return this.backend(bundle, transportLayer);
    }

    async dosboxWorker(bundle: Uint8Array | Uint8Array[]): Promise<CommandInterface> {
        const modules = await this.wasmModules();
        const dosboxWasm = await modules.dosbox();
        const transportLayer = await dosWorker(this.pathPrefix + this.wdosboxJs, dosboxWasm, "session-" + Date.now());
        return this.backend(bundle, transportLayer);
    }

    async janus(restUrl: string): Promise<CommandInterface> {
        return Janus(restUrl);
    }

    async backend(bundle: Uint8Array | Uint8Array[], transportLayer: TransportLayer): Promise<CommandInterface> {
        return new Promise<CommandInterface>((resolve, reject) => {
            const ci = new CommandInterfaceOverTransportLayer(
                Array.isArray(bundle) ? bundle : [bundle],
                transportLayer,
                (err) => {
                    if (err !== null) {
                        reject(err);
                    } else {
                        // can be called from ctor, without timeout can be undefined
                        setTimeout(() => resolve(ci), 4);
                    }
                }
            );
        })
    }

    wasmModules(): Promise<IWasmModules> {
        if (this.wasmModulesPromise !== undefined) {
            return this.wasmModulesPromise;
        }

        const make = async () => {
            const cache = await this.cache();
            return new WasmModulesImpl(this.pathPrefix, this.wdosboxJs, cache);
        }

        this.wasmModulesPromise = make();
        return this.wasmModulesPromise;
    }

    async dosDirect(bundle: Uint8Array | Uint8Array[]): Promise<CommandInterface> {
        return this.dosboxDirect(bundle);
    }

    async dosWorker(bundle: Uint8Array | Uint8Array[]): Promise<CommandInterface> {
        return this.dosboxWorker(bundle);
    }

}

const emulators = new EmulatorsImpl();

export default emulators;
