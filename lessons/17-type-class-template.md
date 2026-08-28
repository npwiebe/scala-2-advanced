# Lesson 17 — Type Class Template

Source: `src/lectures/part4implicits/MyTypeClassTemplate.scala`

Lesson 15 built a full type class from scratch (`HTMLSerializer[T]` in
`TypeClasses.scala`): a trait, implicit instances, a companion `apply`, an
enrichment class, and context bounds. This lesson strips all the domain logic
away and keeps only the **skeleton** — nine lines that are the reusable recipe
for writing *any* type class in Scala. Once you recognize this shape, you'll
see it everywhere: `Numeric[T]`, `Ordering[T]`, circe's `Encoder[T]`, cats'
`Show[T]`, Play's `Writes[T]` — they're all this same template with a
different `action`.

## 1. The trait: what every implementer must provide

```scala
trait MyTypeClassTemplate[T] {
  def action(value: T): String
}
```
(`MyTypeClassTemplate.scala:4-6`)

This is the type class itself — a generic trait parameterized by the type
`T` you want to add behavior for. It says "any type `T` that wants to
participate in this capability must provide an `action` that turns a `T`
into a `String`" (in `HTMLSerializer`'s case, that action was literally named
`serialize`). The trait doesn't know or care what `T` is — `Int`, `User`,
`java.util.Date` — it only cares that *some* instance of
`MyTypeClassTemplate[T]` exists for that `T`.

This is the core type-class idea from Lesson 15 restated generically: instead
of baking a method into a class (`ad-hoc polymorphism via inheritance`), you
define the capability *outside* the type, as its own trait, and provide
separate implicit instances per type. New types get the capability without
touching their source code or the trait's.

## 2. The companion `apply`/summoner: fetching the current instance

```scala
object MyTypeClassTemplate {
  def apply[T](implicit instance: MyTypeClassTemplate[T]) = instance
}
```
(`MyTypeClassTemplate.scala:8-10`)

This is the second half of the recipe, and it's easy to underrate because
it's one line. `apply` takes an **implicit parameter** of type
`MyTypeClassTemplate[T]` and just returns it. Because it's named `apply` on
the companion object, this lets you write:

```scala
MyTypeClassTemplate[Int]
```

and the compiler rewrites that to `MyTypeClassTemplate.apply[Int]`, which
searches implicit scope for a `MyTypeClassTemplate[Int]` instance and hands
it back to you. You've turned "find me the instance for this type" into a
clean, bracket-indexed expression, exactly like `HTMLSerializer[User]` did in
Lesson 15 (`TypeClasses.scala:63,74`) — `HTMLSerializer.apply` is this exact
same one-liner, just with `serializer` as the parameter name instead of
`instance`.

**Why this matters:** without the summoner, if you wanted "the implicit
`MyTypeClassTemplate[T]` currently in scope," you'd have to write an
`implicit instance: MyTypeClassTemplate[T]` parameter on every method that
needed it, and call `instance.action(x)`. The summoner gives you a reusable
one-liner (`MyTypeClassTemplate[T]`) to fetch that instance on demand, from
anywhere — inside a method body, not just as a parameter.

## 3. `implicitly[T]`: Scala already wrote this summoner for you

The exact pattern in section 2 — "take an implicit parameter of type `X`,
return it" — is such a common need that Scala's standard library ships a
generic version of it: `implicitly[T]`. You don't need to hand-write an
`apply` summoner for a type class that has none; `TypeClasses.scala:104,116`
shows both uses side by side:

```scala
val serializer = implicitly[HTMLSerializer[T]]
...
val standardPerms = implicitly[Permissions]
```

`implicitly[HTMLSerializer[T]]` does precisely what
`MyTypeClassTemplate.apply[T]` does — searches implicit scope for a value of
that type and returns it — except it works for *any* type, not just ones
whose companion happens to define `apply`. So `MyTypeClassTemplate`'s hand-
rolled `apply` is really a specialization of `implicitly` that you write
because it reads slightly nicer (`MyTypeClassTemplate[T]` vs.
`implicitly[MyTypeClassTemplate[T]]`), not because it does anything
`implicitly` couldn't already do.

**Gotcha:** both `apply` and `implicitly` *fetch* an existing implicit — they
don't create one. If no implicit `MyTypeClassTemplate[T]` (or whatever type
you ask `implicitly` for) is in scope for the `T` you plug in, you get a
compile error ("could not find implicit value"), not a runtime exception.
That's a feature: a missing type class instance is a compile-time problem.

## 4. Context bounds: sugar for "I need an implicit instance of this"

`TypeClasses.scala:100-107` shows the same method written two ways:

```scala
def htmlBoilerplate[T](content: T)(implicit serializer: HTMLSerializer[T]): String = ...

def htmlSugar[T : HTMLSerializer](content: T): String = {
  val serializer = implicitly[HTMLSerializer[T]]
  ...
}
```

`[T : HTMLSerializer]` is a **context bound** — sugar meaning "add a hidden
implicit parameter of type `HTMLSerializer[T]`." It's exactly equivalent to
the explicit `(implicit serializer: HTMLSerializer[T])` version, just without
naming the parameter in the signature. The tradeoff: since the parameter has
no name, you can't refer to it directly inside the method — you have to
re-summon it with `implicitly[HTMLSerializer[T]]` (or `MyTypeClassTemplate[T]`
if you defined that summoner) when you actually need to call a method on it.

Applied to our template, a method that needs `MyTypeClassTemplate` behavior
for some generic `T` could be written either way:

```scala
def describe[T](x: T)(implicit inst: MyTypeClassTemplate[T]): String = inst.action(x)

def describe[T : MyTypeClassTemplate](x: T): String = MyTypeClassTemplate[T].action(x)
```

Context bounds are why you see `def foo[T: Ordering](...)` or
`def foo[T: Numeric](...)` constantly in the standard library — it's the
idiomatic way to say "this method is generic over `T`, but only for `T`s that
have a type class instance available."

## Key takeaway

`MyTypeClassTemplate.scala` is the type class recipe with the domain-specific
parts sanded off: **(1)** a generic trait declaring the capability
(`action`/`serialize`/whatever), **(2)** implicit instances of that trait per
concrete type (defined elsewhere, e.g. `implicit object UserSerializer`),
**(3)** a companion `apply` (or the built-in `implicitly`) to summon "the
current instance for `T`," and **(4)** context bounds (`[T : MyTypeClassTemplate]`)
as the ergonomic way to require that instance in a generic method's
signature. Every time you see a library type like `Encoder[T]`, `Ordering[T]`,
or `Show[T]` with a matching `Foo[T]` summoner and `def f[T: Foo](...)`
methods, you're looking at this exact four-piece shape.

---

## Exercises

1. Copy the template's shape verbatim but rename it: write
   `trait Comparator[T] { def compare(a: T, b: T): Int }` with a companion
   `apply` summoner. Provide `implicit object IntComparator` and
   `implicit object StringComparator` (by length), then call
   `Comparator[Int].compare(3, 5)` and `Comparator[String].compare("hi", "hello")`.
2. Write a generic method `def maxOf[T: Comparator](a: T, b: T): T` using the
   context-bound form, summoning the instance inside with `implicitly` (or
   your `Comparator[T]` summoner). Confirm it works for both `Int` and
   `String` without changing the method.
3. (Harder) Delete your `Comparator` companion's `apply` method entirely and
   replace every call site that used `Comparator[T]` with
   `implicitly[Comparator[T]]`. Confirm the program behaves identically —
   this should convince you `apply` was never doing anything `implicitly`
   couldn't.
