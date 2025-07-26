// deno-lint-ignore-file no-namespace no-explicit-any ban-types
import { Effect, Data } from "effect";

export class UnknownError extends Data.TaggedError("UNKNOWN_ERROR")<Error> {}

export namespace EffectableTypes {
	export type MethodKeys<T> = {
		[K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
	}[keyof T];

	export type PropertyKeys<T> = {
		[K in keyof T]: T[K] extends (...args: any[]) => any ? never : K;
	}[keyof T];

	export type ExtractMethodReturn<T> = T extends (...args: any[]) => infer R
		? R extends Promise<infer U>
			? U
			: R
		: never;

	export type ExtractMethodArgs<T> = T extends (...args: infer Args) => any
		? Args
		: never;

	export type EffectMethod<TMethod, TError = UnknownError> = TMethod extends (
		...args: infer Args
	) => any
		? (
				...args: Args
			) => Effect.Effect<ExtractMethodReturn<TMethod>, TError, never>
		: never;

	export type EffectableMethods<
		T,
		TErrorMap extends ErrorMap<T>,
		TDefaultError,
	> = {
		readonly [K in MethodKeys<T>]: K extends keyof TErrorMap
			? TErrorMap[K] extends ErrorTransformer<infer E>
				? EffectMethod<T[K], E>
				: EffectMethod<T[K], TDefaultError>
			: EffectMethod<T[K], TDefaultError>;
	};

	export type EffectableProperties<T> = {
		readonly [K in PropertyKeys<T>]: T[K];
	};

	export type Effectable<
		T,
		TErrorMap extends ErrorMap<T>,
		TDefaultError = UnknownError,
	> = EffectableMethods<T, TErrorMap, TDefaultError> &
		EffectableProperties<T> & {
			readonly unsafe: T;
		};

	export type ErrorTransformer<TError = UnknownError> = (
		error: unknown,
	) => TError;

	export type ErrorMap<T> = {
		readonly [K in MethodKeys<T>]?: ErrorTransformer<any>;
	};
}

/**
 * Опции для создания effectable объекта
 * @template T - Тип оборачиваемого объекта
 * @template TDefaultError - Тип ошибки по умолчанию
 */
interface EffectableOptions<T extends object, TDefaultError = UnknownError> {
	/** Трансформер ошибок по умолчанию для всех методов */
	readonly defaultErrorTransformer?: EffectableTypes.ErrorTransformer<TDefaultError>;
	/** Карта трансформеров ошибок для конкретных методов */
	readonly methodErrorTransformers?: EffectableTypes.ErrorMap<T>;
	/** Кэшировать ли результаты методов без аргументов */
	readonly cacheNoArgMethods?: boolean;
}

/**
 * Трансформер ошибок по умолчанию
 * @param error - Исходная ошибка
 * @returns Трансформированная ошибка типа UnknownError
 */
const defaultErrorTransformer: EffectableTypes.ErrorTransformer<
	UnknownError
> = (error: unknown) => {
	return new UnknownError(error as Error);
};

/**
 * Создает фабрику для effectable с предустановленными настройками
 * @template T - Тип оборачиваемого объекта
 * @template TErrorMap - Карта типов ошибок для методов
 * @template TDefaultError - Тип ошибки по умолчанию
 * @param options - Опции для создания effectable
 * @returns Функция для создания effectable объектов
 *
 * @example
 * ```typescript
 * // Пример 1: С кастомным defaultErrorTransformer
 * const createEffectable = effectableFactory<
 *   MyService,
 *   {
 *     fetchData: (error: unknown) => FetchError;
 *     processData: (error: unknown) => ProcessError;
 *   },
 *   GeneralError
 * >({
 *   methodErrorTransformers: {
 *     fetchData: (error) => new FetchError(error),
 *     processData: (error) => new ProcessError(error)
 *   },
 *   defaultErrorTransformer: (error) => new GeneralError(error)
 * });
 *
 * const service = new MyService();
 * const effectService = createEffectable(service);
 *
 * // effectService.fetchData возвращает Effect<Data, FetchError, never>
 * // effectService.processData возвращает Effect<Result, ProcessError, never>
 * // effectService.otherMethod возвращает Effect<Something, GeneralError, never>
 *
 * // Пример 2: С дефолтным UnknownError
 * const createSimpleEffectable = effectableFactory<SimpleService>({
 *   cacheNoArgMethods: true
 * });
 *
 * const simpleService = createSimpleEffectable(new SimpleService());
 * // Все методы возвращают Effect<Result, UnknownError, never>
 * ```
 */
export const effectableFactory = <
	T extends object,
	TErrorMap extends EffectableTypes.ErrorMap<T> = {},
	TDefaultError = UnknownError,
>(
	options: EffectableOptions<T, TDefaultError> = {},
) => {
	const {
		defaultErrorTransformer:
			defaultTransform = defaultErrorTransformer as EffectableTypes.ErrorTransformer<TDefaultError>,
		methodErrorTransformers = {} as TErrorMap,
		cacheNoArgMethods = true,
	} = options;

	/**
	 * Создает effectable обертку над объектом
	 * @param context - Исходный объект для оборачивания
	 * @returns Effectable объект с методами, возвращающими Effect
	 */
	return (
		context: T,
	): EffectableTypes.Effectable<T, TErrorMap, TDefaultError> => {
		const methodCache = cacheNoArgMethods
			? new Map<string | symbol, Effect.Effect<any, any, never>>()
			: null;

		const isMethod = (value: unknown): value is Function =>
			typeof value === "function";

		const getErrorTransformer = (key: string | symbol) => {
			const customTransformer = (methodErrorTransformers as any)[key];
			return customTransformer || defaultTransform;
		};

		const wrapMethod = (method: Function, key: string | symbol) => {
			return (...args: ReadonlyArray<any>) => {
				// Проверяем кэш для методов без аргументов
				if (cacheNoArgMethods && args.length === 0 && methodCache?.has(key)) {
					return methodCache.get(key)!;
				}

				const errorTransformer = getErrorTransformer(key);

				const effect = Effect.async<any, any, never>((resume) => {
					try {
						const result = method.apply(context, args);

						if (result instanceof Promise) {
							result
								.then((value) => resume(Effect.succeed(value)))
								.catch((error) => resume(Effect.fail(errorTransformer(error))));
						} else {
							resume(Effect.succeed(result));
						}
					} catch (error) {
						resume(Effect.fail(errorTransformer(error)));
					}
				});

				// Кэшируем результат для методов без аргументов
				if (cacheNoArgMethods && args.length === 0 && methodCache) {
					methodCache.set(key, effect);
				}

				return effect;
			};
		};

		return new Proxy(
			{} as EffectableTypes.Effectable<T, TErrorMap, TDefaultError>,
			{
				get(_, prop) {
					if (prop === "unsafe") return context;

					const value = context[prop as keyof T];
					if (isMethod(value)) {
						return wrapMethod(value, prop);
					}

					return value;
				},
				has(_, prop) {
					return prop === "unsafe" || prop in context;
				},
				ownKeys() {
					return [...Object.keys(context), "unsafe"] as const;
				},
				getOwnPropertyDescriptor(_, prop) {
					if (prop === "unsafe") {
						return {
							configurable: true,
							enumerable: true,
							value: context,
						};
					}

					const descriptor = Object.getOwnPropertyDescriptor(context, prop);
					if (descriptor) {
						return {
							...descriptor,
							configurable: true,
							enumerable: true,
						};
					}
				},
			},
		);
	};
};

/**
 * Создает effectable обертку с настройками по умолчанию
 * @template T - Тип оборачиваемого объекта
 * @param context - Исходный объект
 * @param options - Опции (необязательно)
 * @returns Effectable объект
 *
 * @example
 * ```typescript
 * const service = new MyService();
 * const effectService = effectable(service);
 *
 * // Использование
 * const result = await Effect.runPromise(
 *   effectService.someMethod("arg")
 * );
 * ```
 */
export const effectable = <T extends object>(
	context: T,
	options: EffectableOptions<T> = {},
): EffectableTypes.Effectable<T, {}, UnknownError> => {
	const factory = effectableFactory<T, {}, UnknownError>(options);
	return factory(context);
};
