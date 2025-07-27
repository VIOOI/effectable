# Effectable

A powerful TypeScript library that transforms any object into an Effect-ts compatible interface, enabling functional programming patterns with automatic error handling, type safety, and performance optimizations.

## 🚀 Features

- **🔄 Automatic Effect Wrapping**: Transform any object methods to return Effect-ts Effects
- **🛡️ Type-Safe Error Handling**: Custom error transformers with full TypeScript support  
- **⚡ Performance Optimized**: Built-in caching for zero-argument methods (O(1) access)
- **🎯 Immutable Design**: Readonly arrays, `as const` assertions, pure functions
- **🔧 Flexible Configuration**: Method-specific error transformers and global defaults
- **📦 Deno Ready**: Built specifically for Deno runtime environments
- **🏭 Production Grade**: Designed for high-load Microsoft-scale systems


## 🎯 Quick Start

### Basic Usage

```typescript
import { Effect } from "effect";
import { effectable } from "./effectable.ts";

// Your existing service
class DatabaseService {
  async findUser(id: string): Promise<User> {
    // Database logic here
    return await db.users.findById(id);
  }
  
  getUserCount(): number {
    return this.cache.userCount;
  }
}

// Wrap with effectable
const dbService = new DatabaseService();
const effectDbService = effectable(dbService);

// Now all methods return Effects
const program = Effect.gen(function* (_) {
  const user = yield* _(effectDbService.findUser("123"));
  const count = yield* _(effectDbService.getUserCount());
  
  return { user, count };
});

// Execute the program
const result = await Effect.runPromise(program);
```

### Advanced Error Handling

```typescript
import { Data } from "effect";

// Define custom errors
export class DatabaseError extends Data.TaggedError("DATABASE_ERROR")<{
  message: string;
  code: number;
}> {}

export class ValidationError extends Data.TaggedError("VALIDATION_ERROR")<{
  field: string;
  value: unknown;
}> {}

// Create factory with custom error handling
const createDbEffectable = effectableFactory<
  DatabaseService,
  {
    findUser: (error: unknown) => DatabaseError;
    validateInput: (error: unknown) => ValidationError;
  },
  DatabaseError
>({
  methodErrorTransformers: {
    findUser: (error) => new DatabaseError({ 
      message: error instanceof Error ? error.message : "Unknown database error",
      code: 500 
    }),
    validateInput: (error) => new ValidationError({
      field: "unknown",
      value: error
    })
  },
  defaultErrorTransformer: (error) => new DatabaseError({ 
    message: "General database error", 
    code: 500 
  }),
  cacheNoArgMethods: true
});

const effectDbService = createDbEffectable(new DatabaseService());

// Type-safe error handling
const program = Effect.gen(function* (_) {
  const user = yield* _(effectDbService.findUser("123")); // Effect<User, DatabaseError, never>
  return user;
}).pipe(
  Effect.catchAll((error) => {
    if (error._tag === "DATABASE_ERROR") {
      console.error(`Database error ${error.code}: ${error.message}`);
    }
    return Effect.succeed(null);
  })
);
```

## 🏗️ Architecture Patterns

### Service Layer Pattern

```typescript
// Define your service interfaces
interface UserRepository {
  readonly findById: (id: string) => Promise<User>;
  readonly findByEmail: (email: string) => Promise<User | null>;
  readonly create: (user: CreateUserRequest) => Promise<User>;
  readonly update: (id: string, data: UpdateUserRequest) => Promise<User>;
  readonly delete: (id: string) => Promise<void>;
}

interface EmailService {
  readonly sendWelcome: (user: User) => Promise<void>;
  readonly sendPasswordReset: (email: string) => Promise<void>;
}

// Error types for each service
export class UserRepositoryError extends Data.TaggedError("USER_REPO_ERROR")<{
  operation: string;
  userId?: string;
  cause: unknown;
}> {}

export class EmailServiceError extends Data.TaggedError("EMAIL_SERVICE_ERROR")<{
  recipient: string;
  template: string;
  cause: unknown;
}> {}

// Create service factories
const createUserRepoEffectable = effectableFactory<
  UserRepository,
  {
    findById: (error: unknown) => UserRepositoryError;
    findByEmail: (error: unknown) => UserRepositoryError;
    create: (error: unknown) => UserRepositoryError;
    update: (error: unknown) => UserRepositoryError;
    delete: (error: unknown) => UserRepositoryError;
  }
>({
  methodErrorTransformers: {
    findById: (error) => new UserRepositoryError({ 
      operation: "findById", 
      cause: error 
    }),
    findByEmail: (error) => new UserRepositoryError({ 
      operation: "findByEmail", 
      cause: error 
    }),
    create: (error) => new UserRepositoryError({ 
      operation: "create", 
      cause: error 
    }),
    update: (error) => new UserRepositoryError({ 
      operation: "update", 
      cause: error 
    }),
    delete: (error) => new UserRepositoryError({ 
      operation: "delete", 
      cause: error 
    })
  }
});
```
## 🔧 Configuration Options

### EffectableOptions

```typescript
interface EffectableOptions<T extends object, TDefaultError = UnknownError> {
  /** Default error transformer for all methods */
  readonly defaultErrorTransformer?: ErrorTransformer<TDefaultError>;
  
  /** Method-specific error transformers */
  readonly methodErrorTransformers?: ErrorMap<T>;
  
  /** Cache results of methods with no arguments (default: true) */
  readonly cacheNoArgMethods?: boolean;
}
```

### Error Transformers

```typescript
type ErrorTransformer<TError = UnknownError> = (error: unknown) => TError;

// Example transformers
const httpErrorTransformer = (error: unknown): HttpError => {
  if (error instanceof Response) {
    return new HttpError({ 
      status: error.status, 
      message: error.statusText 
    });
  }
  return new HttpError({ 
    status: 500, 
    message: "Internal Server Error" 
  });
};

const validationErrorTransformer = (error: unknown): ValidationError => {
  // Transform zod errors, joi errors, etc.
  return parseValidationError(error);
};
```

## 🚀 Performance Considerations

### Method Caching
- Zero-argument methods are cached by default (O(1) access)
- Cache is per-instance and lives for the object's lifetime
- Disable caching by setting `cacheNoArgMethods: false`

### Memory Usage
- Minimal overhead: only stores method references and error transformers
- Proxy-based implementation with lazy evaluation
- No memory leaks: cache is garbage collected with the object

### Error Handling Performance
- Error transformers are called only when errors occur
- Pre-compiled error transformers for O(1) error handling
- No stack trace pollution in production builds

## 📚 API Reference

### Functions

#### `effectable<T>(context: T, options?: EffectableOptions<T>)`
Creates an effectable wrapper with default settings.

**Parameters:**
- `context: T` - The object to wrap
- `options: EffectableOptions<T>` - Optional configuration

**Returns:** `Effectable<T, {}, UnknownError>`

#### `effectableFactory<T, TErrorMap, TDefaultError>(options: EffectableOptions<T, TDefaultError>)`
Creates a factory function for creating effectable objects with pre-configured settings.

**Parameters:**
- `options: EffectableOptions<T, TDefaultError>` - Configuration options

**Returns:** Function that creates effectable objects

### Types

- `Effectable<T, TErrorMap, TDefaultError>` - The main effectable type
- `ErrorTransformer<TError>` - Function type for transforming errors  
- `ErrorMap<T>` - Map of method names to error transformers
- `EffectableOptions<T, TDefaultError>` - Configuration options
