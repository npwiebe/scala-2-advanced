# Lesson 30 — Reflection

Source: `src/lectures/part5ts/Reflection.scala`

This is the final lesson in the course. Reflection is the runtime API that
lets a Scala program inspect and manipulate its own classes, methods, and
types *while it's running* — instead of everything being nailed down at
compile time. It's a niche corner of everyday app code, but it's the
mechanism quietly underneath every JSON library, ORM, and dependency-injection
framework you've ever used.

## The motivating problem: JVM type erasure

```scala
val numbers = List(1,2,3)
numbers match  {
  case listOfStrings: List[String] => println("list of strings")
  case listOfNumbers: List[Int] => println("list of numbers")
}
```
(`Reflection.scala:50-54`)

Scala's generics (`List[Int]`, `List[String]`) exist only at compile time. The
JVM bytecode that both of these compile to is just `List`, full stop — the
type parameter is erased. At runtime there is no way to ask a `List` "are you
a `List[Int]` or a `List[String]`?" because that information doesn't exist
anymore; it was only ever a compile-time fiction used for type-checking. The
first `case` above actually matches (with a compiler warning), because
"list of `String`" and "list of `Int`" are literally the same runtime class.

This is **type erasure**, and it's not a Scala quirk — it's a JVM design
decision inherited from Java, dating back to when generics were retrofitted
onto a runtime that never had them. The consequence called out at
`Reflection.scala:56-58` is concrete: you *cannot* overload two methods that
only differ by a generic type argument —

```scala
//  def processList(list: List[Int]): Int = 43
//  def processList(list: List[String]): Int = 45
```

— because after erasure both signatures are `processList(list: List): Int`,
a duplicate-method compile error. Reflection (and its lighter cousin,
`ClassTag`/`TypeTag`) exists to work around exactly this: it gives you a way
to smuggle type information that would otherwise vanish at erasure through to
runtime, as an explicit value the compiler builds for you.

## `TypeTag`: type information smuggled in as an implicit

```scala
val ttag = typeTag[Person]
println(ttag.tpe)
```
(`Reflection.scala:66-67`)

A `TypeTag[T]` is a compiler-generated object that carries a full, runtime-
inspectable description of type `T` — everything the compiler knew about `T`
at compile time, packaged into a value you can still hold onto after erasure
has thrown the type parameter away. `typeTag[Person]` doesn't reflect on an
*instance*; it reflects on the *type itself*, giving you `ttag.tpe`, a
`Type` object you can query, compare, and pattern-match on.

`ClassTag[T]` (mentioned alongside `TypeTag` at the top of the file) is a
lighter-weight version: it only carries the erased runtime class of `T`
(enough to build an `Array[T]` or do a runtime `isInstanceOf` check), whereas
`TypeTag` carries the *full* compile-time type, including generic arguments.
`TypeTag` is what lets you ask "was this a `List[Int]` or `List[String]`?" —
information a plain `ClassTag` has already thrown away.

## TypeTags are passed around exactly like the summoner pattern from Lesson 17

```scala
def getTypeArguments[T](value: T)(implicit typeTag: TypeTag[T]) = typeTag.tpe match {
  case TypeRef(_, _, typeArguments) => typeArguments
  case _ => List()
}

val myMap = new MyMap[Int, String]
val typeArgs = getTypeArguments(myMap) //(typeTag: TypeTag[MyMap[Int,String]])
println(typeArgs)
```
(`Reflection.scala:69-79`)

Look closely at the signature: `(implicit typeTag: TypeTag[T])`. This is the
*exact* mechanism from Lesson 17's type class template — an implicit
parameter that the compiler fills in for you at the call site, without you
writing anything at `getTypeArguments(myMap)`. The compiler sees you're
calling a generic method on a `MyMap[Int, String]`, so it auto-generates
(there's no explicit `implicit val typeTag = ...` anywhere in this file — the
compiler manufactures the `TypeTag[MyMap[Int,String]]` instance itself, the
same way it manufactures `Ordering[Int]` or any other implicit) and threads
it through invisibly. `typeTag.tpe` then gives you back a `TypeRef`, and
destructuring it yields `List(Int, String)` — the generic type arguments,
recovered *after* erasure would otherwise have destroyed them.

This is why the phrase "implicit evidence" from Lesson 17 fits `TypeTag`
perfectly: it's not a type class you write instances for by hand (there's no
`implicit object PersonTypeTag`), but it's summoned the identical way — as an
implicit parameter that the compiler resolves and injects — and it exists for
the identical reason a type class does: carrying capability/information about
a generic `T` from the call site into the method body.

`Reflection.scala:81-87` uses the same pattern to compare two types directly:

```scala
def isSubtype[A, B](implicit ttagA: TypeTag[A], ttagB: TypeTag[B]): Boolean = {
  ttagA.tpe <:< ttagB.tpe
}

class Animal
class Dog extends Animal
println(isSubtype[Dog, Animal])  // true
```

`<:<` on a `Type` is the runtime version of the `<:` subtype bound you'd
otherwise only get to check at compile time — now you can ask "is `A` a
subtype of `B`?" as a boolean at runtime, driven entirely by `TypeTag`s the
compiler summoned for you.

## Full reflection: inspecting and invoking members by name

The `TypeTag` machinery answers "what type is this?". Full reflection
(`scala.reflect.runtime.universe`) goes further and lets you construct
instances and invoke methods *by name*, as strings, discovered at runtime.
`Reflection.scala:14-30` walks the whole ceremony for constructing a
`Person` you only know the fully-qualified name of:

```scala
import scala.reflect.runtime.{universe => ru}

val m = ru.runtimeMirror(getClass.getClassLoader)                          // 1 - MIRROR
val clazz = m.staticClass("advanced.part5ts.Reflection.Person")            // 2 - class object by NAME
val cm = m.reflectClass(clazz)                                             // 3 - reflected mirror ("can DO things")
val constructor = clazz.primaryConstructor.asMethod                        // 4 - the constructor
val constructorMirror = cm.reflectConstructor(constructor)                 // 5 - reflect the constructor
val instance = constructorMirror.apply("John")                             // 6 - invoke it
```

Each step hands you a slightly more "activated" object: a **mirror**
(`runtimeMirror`) is the entry point into the reflective universe for a given
classloader; a **class symbol** (`staticClass`) is a *description* of a class
looked up purely by its string name (no `Person` reference needed anywhere in
this code — that's the whole point, you might only have this name because it
arrived over the wire); a **reflected class** (`reflectClass`) can actually
*do* things with that description, like locate and reflect the constructor;
and the constructor mirror can finally be `apply`-ed like a real constructor
call, producing a genuine `Person("John")`.

`Reflection.scala:32-45` does the same thing for invoking a method whose name
is only known as a `String`:

```scala
val p = Person("Mary")           // from the wire as a serialized object
val methodName = "sayMyName"     // method name computed from somewhere else

val reflected = m.reflect(p)                                            // reflect the instance
val methodSymbol = ru.typeOf[Person].decl(ru.TermName(methodName)).asMethod  // find the method by name
val method = reflected.reflectMethod(methodSymbol)                      // reflect the method
method.apply()                                                          // invoke it -> "Hi, my name is Mary"
```

`ru.typeOf[Person].decl(...)` is reflection inspecting the *members* of
`Person` — you can list/query fields and methods of a type without ever
having declared them in code you wrote, purely by asking the `Type` object
what it `decl`ares. The comments "from the wire" and "computed from
somewhere else" are the file's own hint at the real use case, addressed next.

Finally, `Reflection.scala:93-97` shows `TypeTag` and full reflection meeting
in the middle: you can get the same method symbol via `typeTag[Person].tpe`
instead of `ru.typeOf[Person]` — they're two doors into the same underlying
`Type` representation.

**Gotcha:** every one of these calls (`staticClass`, `decl`, `reflectMethod`)
takes a *string* or resolves a name at runtime, and every one of them can
therefore fail at runtime — a typo in `"sayMyName"` or a class renamed since
the string was written gives you a runtime exception, not a compile error.
This is the opposite trade-off from the "missing implicit = compile error"
guarantee you get from ordinary type classes (Lesson 17) — reflection
deliberately gives up compile-time safety to gain the ability to act on types
it only learns about after the program starts.

## Why any of this matters: the realistic use case

You will almost never hand-write mirror/class-symbol/constructor-mirror
ceremony like this in application code. But you use libraries that do it for
you constantly. A JSON library (circe, Play JSON, Jackson-for-Scala) or an
ORM has to turn a `Person` into `{"name": "John"}` and back — but the library
was compiled long before it ever saw your `Person` class. It doesn't have
`Person` hardcoded; it needs to, at runtime, given *some* class it's told
about generically, discover "what fields does this have, what are their
names and types, how do I construct one from a map of field values." That is
precisely the `staticClass` → `reflectClass` → `reflectConstructor` chain
above, and precisely why `decl(TermName(...))` exists — the field/method name
comes from the JSON key, a string, exactly like `methodName` in this file.
Same story for dependency-injection frameworks (build `Foo` by discovering
its constructor's parameter types and looking up an instance for each) and
for test frameworks that discover and invoke `@Test`-annotated methods by
name. Every one of these tools is doing this file's dance, just with more
error handling and caching around it.

## Key takeaway

Type erasure means generic type parameters are compile-time-only information
that the JVM throws away — you cannot recover `List[Int]` vs. `List[String]`
at runtime, and you cannot overload methods that differ only by type
argument. `TypeTag`/`ClassTag` are the compiler's answer: values that carry
the erased type information forward, summoned via the exact same implicit-
parameter mechanism as any type class (Lesson 17) — the compiler builds them
for you rather than you writing `implicit object` instances by hand. Full
runtime reflection goes a step further, letting you look up classes,
constructors, fields, and methods purely by name at runtime and invoke them —
trading the compile-time safety of ordinary Scala for the ability to act on
types your code only discovers after it's already running. That trade-off is
exactly what serialization libraries, ORMs, and DI frameworks need, and now
you know what's actually happening underneath `Json.parse[Person]` the next
time you use one.

---

## Exercises

1. Using the exact pattern at `Reflection.scala:66-79`, write a method
   `def firstTypeArg[T](value: T)(implicit tag: TypeTag[T]): Type` that
   returns just the *first* generic type argument of `T` (reuse the
   `TypeRef(_, _, typeArguments)` match, but return `typeArguments.head`).
   Call it on a `Map[String, Int]` and print the result — confirm it prints
   `String`, not `Int`.
2. Write a `case class Robot(model: String)` with a method `def beep(): Unit
   = println(s"$model says beep!")`. Using the mirror/class-symbol/
   constructor-mirror steps from `Reflection.scala:17-30`, construct a
   `Robot` by its fully-qualified string name and invoke `beep` by its
   string method name (`"beep"`), the way `sayMyName` is invoked at
   `Reflection.scala:38-45`. Do it without ever writing `new Robot(...)` or
   `.beep()` directly in your reflection code.
3. (Harder) Write `def sameRuntimeClass[A, B](a: A, b: B)(implicit ca: ClassTag[A], cb: ClassTag[B]): Boolean`
   that compares `ca.runtimeClass == cb.runtimeClass`, and a second method
   `def sameCompileTimeType[A, B](implicit ta: TypeTag[A], tb: TypeTag[B]): Boolean`
   using `ta.tpe =:= tb.tpe`. Call both with `A = List[Int]` and
   `B = List[String]` and explain in a comment why the `ClassTag` version
   returns `true` while the `TypeTag` version returns `false` — you should be
   able to answer this directly from what type erasure does and doesn't
   destroy.

---

## Course complete

That's the last lesson. Over thirty lessons you went from syntax sugar and
pattern matching through implicits, type classes, variance, higher-kinded
types, and finally the runtime-reflection escape hatch that libraries reach
for when compile-time types aren't enough. You now have the vocabulary to
read almost any advanced Scala 2 codebase and recognize *why* it's shaped the
way it is, not just *that* it works.

A few concrete next steps if you want to keep going:

- **Cats / Cats Effect** — you already know type classes, implicits, and
  variance from this course; Cats is those same ideas (`Functor`, `Monad`,
  `Show`) applied as a real, production-grade library. Cats Effect adds a
  principled `IO` type for managing side effects functionally.
- **ZIO** — a different, more opinionated take on the same functional-effects
  territory as Cats Effect, with strong typed-error handling and
  dependency injection built on the environment type — a great next example
  of type classes and implicits (or their ZIO equivalents) at scale.
- **Build something end-to-end** — pick a small project (a CLI tool, a tiny
  JSON-backed web service) and deliberately apply what you learned: define
  your own type class for something domain-specific, use implicit
  conversions/context bounds instead of inheritance, and reach for
  `ClassTag`/reflection only if you actually hit type erasure. Seeing these
  tools solve a real problem you chose is what will make them stick.
