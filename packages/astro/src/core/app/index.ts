import type { ComponentInstance, ManifestData, RouteData, GetStaticPathsResultKeyed, GetStaticPathsResult, GetStaticPathsItem, Renderer } from '../../@types/astro';
import type {
	SSRManifest as Manifest, RouteInfo
} from './types';

import { defaultLogOptions } from '../logger.js';
import { matchRoute } from '../routing/match.js';
import { render } from '../render/core.js';
import { RouteCache } from '../render/route-cache.js';
import { createLinkStylesheetElementSet, createModuleScriptElementWithSrcSet } from '../render/ssr-element.js';
import { createRenderer } from '../render/renderer.js';
import { prependForwardSlash } from '../path.js';

export abstract class BaseApp {
	#manifest: Manifest;
	#manifestData: ManifestData;
	#rootFolder: URL;
	#routeDataToRouteInfo: Map<RouteData, RouteInfo>;
	#routeCache: RouteCache;
	#renderersPromise: Promise<Renderer[]>;

	constructor(manifest: Manifest, rootFolder: URL) {
		this.#manifest = manifest;
		this.#manifestData = {
			routes: manifest.routes.map(route => route.routeData)
		};
		this.#rootFolder = rootFolder;
		this.#routeDataToRouteInfo = new Map(
			manifest.routes.map(route => [route.routeData, route])
		);
		this.#routeCache = new RouteCache(defaultLogOptions);
		this.#renderersPromise = this.#loadRenderers();
	}
	protected abstract match(req: any): RouteData | undefined;
	matchURL({ pathname }: URL): RouteData | undefined {
		return matchRoute(pathname, this.#manifestData);
	}
	abstract render(req: any, routeData?: RouteData): Promise<string>;
	protected async renderData(url: URL, data: any, routeData?: RouteData): Promise<string> {
		if(!routeData) {
			routeData = this.matchURL(url);
			if(!routeData) {
				return 'Not found';
			}
		}

		const manifest = this.#manifest;
		const info = this.#routeDataToRouteInfo.get(routeData!)!;
		const smallCache = new RouteCache(defaultLogOptions);
		const staticPaths: GetStaticPathsResult = [
			data
		];
		const keyedStaticPaths = staticPaths as GetStaticPathsResultKeyed;
		keyedStaticPaths.keyed = new Map<string, GetStaticPathsItem>();
		for (const sp of keyedStaticPaths) {
			const paramsKey = JSON.stringify(sp.params);
			keyedStaticPaths.keyed.set(paramsKey, sp);
		}

		const [mod, renderers] = await Promise.all([
			this.#loadModule(info.file),
			this.#renderersPromise
		]);

		const links = createLinkStylesheetElementSet(info.links, manifest.site);
		const scripts = createModuleScriptElementWithSrcSet(info.scripts, manifest.site);

		return render({
			experimentalStaticBuild: true,
			links,
			logging: defaultLogOptions,
			markdownRender: manifest.markdown.render,
			mod,
			origin: url.origin,
			pathname: url.pathname,
			scripts,
			renderers,
			async resolve(specifier: string) {
				if(!(specifier in manifest.entryModules)) {
					throw new Error(`Unable to resolve [${specifier}]`);
				}
				const bundlePath = manifest.entryModules[specifier];
				return prependForwardSlash(bundlePath);
			},
			route: routeData,
			routeCache: smallCache,
			site: this.#manifest.site
		})
	}

	protected async renderURL(url: URL, routeData?: RouteData): Promise<string> {
		if(!routeData) {
			routeData = this.matchURL(url);
			if(!routeData) {
				return 'Not found';
			}
		}

		const manifest = this.#manifest;
		const info = this.#routeDataToRouteInfo.get(routeData!)!;
		const [mod, renderers] = await Promise.all([
			this.#loadModule(info.file),
			this.#renderersPromise
		]);

		const links = createLinkStylesheetElementSet(info.links, manifest.site);
		const scripts = createModuleScriptElementWithSrcSet(info.scripts, manifest.site);

		return render({
			experimentalStaticBuild: true,
			links,
			logging: defaultLogOptions,
			markdownRender: manifest.markdown.render,
			mod,
			origin: url.origin,
			pathname: url.pathname,
			scripts,
			renderers,
			async resolve(specifier: string) {
				if(!(specifier in manifest.entryModules)) {
					throw new Error(`Unable to resolve [${specifier}]`);
				}
				const bundlePath = manifest.entryModules[specifier];
				return prependForwardSlash(bundlePath);
			},
			route: routeData,
			routeCache: this.#routeCache,
			site: this.#manifest.site
		})
	}
	async #loadRenderers(): Promise<Renderer[]> {
		const rendererNames = this.#manifest.renderers;
		return await Promise.all(rendererNames.map(async (rendererName) => {
			return createRenderer(rendererName, {
				renderer(name) {
					return import(name);
				},
				server(entry) {
					return import(entry);
				}
			})
		}));
	}
	async #loadModule(rootRelativePath: string): Promise<ComponentInstance> {
		let modUrl = new URL(rootRelativePath, this.#rootFolder).toString();
		let mod: ComponentInstance;
		try {
			mod = await import(modUrl);
			return mod;
		} catch(err) {
			throw new Error(`Unable to import ${modUrl}. Does this file exist?`);
		}
	}
}
