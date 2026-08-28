# Lesson 15 — Type Classes

Source: `src/lectures/part4implicits/TypeClasses.scala`

This lesson assumes Lessons 12-14 (implicits, organizing implicits, implicit
classes). Everything here is built out of those two tools: implicit values/
objects (for lookup) and implicit classes (for enrichment). A "type class" is
just a *design pattern* that combines them — there's no new language feature
to learn, only a new way of arranging the ones you already know.

## The problem: how do you add a capability to a type?

```scala
trait HTMLWritable {
  def toHtml: String
}

case class User(name: String, age: Int, email: String) extends HTMLWritable {
  override def toHtml: String = s"<div>$name ($age yo) <a href=$email/> </div>"
}
```
(lines 8-13) The obvious OO answer: make `HTMLWritable` a trait and have `User`
extend it. This works, but only for **types we wrote ourselves**, and only for
**one** implementation. You can't retroactively make `java.util.Date`
`HTMLWritable` — you don't own that class — and if you need two different HTML
renderings of `User` (say, full vs. partial), you're stuck, because a class can
only carry one `toHtml` implementation baked into its own body.

A second bad answer is pattern matching on `Any`:

```scala
object HTMLSerializerPM {
  def serializeToHtml(value: Any) = value match {
    case User(n, a, e) =>
    case _ =>
  }
}
```
(lines 23-28) This sidesteps the "types we don't own" problem (you can match
on anything), but now you've lost type safety (`Any` in, `Any` out — the
compiler won't stop you calling this on garbage), and you still have to modify
this one `match` every time a new type needs serializing, and you're still
limited to one implementation.

## 1. The type class trait — describing a capability, not a type

```scala
trait HTMLSerializer[T] {
  def serialize(value: T): String
}
```
(lines 36-38) This is the core shift. Instead of `User extends HTMLWritable`
(the type *is-a* HTML-writable thing), we define a **separate**, generic trait
parametrized by the type it applies to. `HTMLSerializer[T]` says "here's how to
serialize *some* `T`" — it doesn't touch `T` itself at all. `T` never has to
know this trait exists.

This is the essential contrast with inheritance:
- **Inheritance**: you modify the type itself (`class User extends HTMLWritable`).
  You need write access to the source, and you get exactly one implementation
  per type, forever.
- **Type class**: you describe, from the *outside*, what capability *can be*
  provided for a type. The type stays untouched. Multiple, independent
  descriptions of "how to serialize a `User`" can coexist.

## 2. Type class instances — one implicit per (type, behavior)

```scala
implicit object UserSerializer extends HTMLSerializer[User] {
  def serialize(user: User): String = s"<div>${user.name} (${user.age} yo) <a href=${user.email}/> </div>"
}
```
(lines 40-42) An "instance" of the type class for `User` is just a value of
type `HTMLSerializer[User]`, marked `implicit` so it can be found automatically
(exactly the implicit-value mechanism from Lesson 12). Nothing stops you from
writing more:

```scala
object DateSerializer extends HTMLSerializer[Date] { ... }        // line 49
object PartialUserSerializer extends HTMLSerializer[User] { ... } // line 54
implicit object IntSerializer extends HTMLSerializer[Int] { ... } // line 66
```
This directly answers both complaints about inheritance: `DateSerializer`
gives `java.util.Date` — a type we don't own and can't extend — HTML behavior
from the outside; and `PartialUserSerializer` gives `User` a *second*,
independent serialization alongside `UserSerializer`, with no `override`
conflict, because they're just separate objects, not competing method bodies
in the same class.

The type class trait's companion object typically also grows a generic entry
point using implicit resolution (Lesson 13's "organizing implicits" — the
compiler searches companion objects and the implicit scope for a match):

```scala
object HTMLSerializer {
  def serialize[T](value: T)(implicit serializer: HTMLSerializer[T]): String =
    serializer.serialize(value)

  def apply[T](implicit serializer: HTMLSerializer[T]) = serializer
}
```
(lines 59-64) `HTMLSerializer.serialize(42)` (line 70) lets the compiler pick
`IntSerializer` automatically because it's `implicit` and in scope. `apply`
gives you `HTMLSerializer[User]` as a value (line 74's
`HTMLSerializer[User].serialize(john)`) — handy when you want the whole
type-class instance, not just a one-off call.

## 3. The "ops" layer — an implicit class for nice call syntax

```scala
implicit class HTMLEnrichment[T](value: T) {
  def toHTML(implicit serializer: HTMLSerializer[T]): String = serializer.serialize(value)
}

println(john.toHTML)  // println(new HTMLEnrichment[User](john).toHTML(UserSerializer))
```
(lines 78-82) This is exactly the "pimp my library" pattern from Lesson 14 —
`HTMLEnrichment` is an implicit class wrapping any `T`, adding a `.toHTML`
method to it. What makes it a *type class* enrichment specifically is that
`toHTML` takes its own `serializer` as an **implicit parameter**: the compiler
fills it in by searching for an implicit `HTMLSerializer[T]` (Lesson 13's
resolution rules again — companion object of `HTMLSerializer`, companion
object of `T`, local implicit scope, in that order).

The three pieces now compose:

```
type class trait      → HTMLSerializer[T]            (what capability looks like)
type class instances  → UserSerializer, IntSerializer  (implicit values providing it, per type)
enrichment/"ops"       → HTMLEnrichment (implicit class)  (nice call syntax: value.toHTML)
```

Because the serializer is just another implicit parameter, you can also
**override** the compiler's choice explicitly:

```scala
println(2.toHTML)                          // uses IntSerializer implicitly
println(john.toHTML(PartialUserSerializer)) // explicit override — line 91
```
`PartialUserSerializer` isn't even `implicit` (line 54 has no `implicit`
keyword) — it doesn't need to be, because here it's supplied by hand, not
found by search. That's the flexibility promised earlier: pick a default
behavior via implicits, but let any call site substitute a different, valid
implementation without touching `User` or `HTMLSerializer` at all.

Gotcha: `2.toHTML` only compiles because `IntSerializer` is `implicit` *and* in
scope. If you comment out `implicit` on line 66, `2.toHTML` fails to compile
with "could not find implicit value for parameter serializer" — the enrichment
method exists, but the compiler has nothing to plug into its implicit
parameter.

## Context bounds: the same thing, shorter

```scala
def htmlBoilerplate[T](content: T)(implicit serializer: HTMLSerializer[T]): String =
  s"<html><body> ${content.toHTML(serializer)}</body></html>"

def htmlSugar[T : HTMLSerializer](content: T): String = {
  val serializer = implicitly[HTMLSerializer[T]]
  s"<html><body> ${content.toHTML(serializer)}</body></html>"
}
```
(lines 100-107) `[T : HTMLSerializer]` is sugar for "add an implicit
`HTMLSerializer[T]` parameter you don't need to name" — the compiler still adds
it behind the scenes, you just recover it inside the method body with
`implicitly[HTMLSerializer[T]]` (Lesson 12's `implicitly`) when you need to
pass it along explicitly. This is the idiomatic, terse way type-class-
constrained generic functions are written in real Scala code — you'll see
`def foo[T: Ordering](...)`, `def bar[T: Numeric](...)`, etc. everywhere.

```scala
case class Permissions(mask: String)
object Permissions {
  implicit val defaultPermissions: Permissions = Permissions("0744")
}
val standardPerms = implicitly[Permissions]
```
(lines 110-116) `implicitly[T]` works for *any* implicit value, not just type
class instances — it's just "ask the compiler to find me an implicit `T` right
now." Type classes are the most common reason you'd reach for it, but the
mechanism is general.

## Key takeaway

A type class decouples "what a type *is*" from "what can be *done with* it."
The trait (`HTMLSerializer[T]`) declares a capability parametrized over the
type it targets; implicit instances (`UserSerializer`, `IntSerializer`,
`DateSerializer`, ...) each independently provide that capability for one
type, including types you don't own and with multiple competing
implementations; and an implicit class (`HTMLEnrichment`) layers ergonomic
call syntax (`value.toHTML`) on top, using an implicit parameter so the right
instance is found automatically but can always be overridden by hand. This is
strictly more flexible than requiring every type to extend a shared trait: no
source access is required, any number of implementations can coexist, and new
capabilities can be bolted onto old, closed, or third-party types without
touching a single line of them.

---

## Exercises

1. Write a type class `Comparator[T]` with `def compare(a: T, b: T): Int`
   (negative/zero/positive, like `java.util.Comparator`). Provide implicit
   instances for `Int` (numeric order) and `String` (length order), plus an
   implicit class enrichment adding `def <=>(other: T)(implicit c: Comparator[T]): Int`
   so you can write `3 <=> 5` and `"abc" <=> "de"`.
2. Add a *second*, non-implicit `Comparator[Int]` instance that compares by
   absolute value, and call `<=>` with it passed explicitly, the same way
   `john.toHTML(PartialUserSerializer)` overrides the default on line 91.
   Confirm the implicit default still applies when you omit the argument.
3. Write `def describe[T : Comparator](a: T, b: T): String` using the context
   bound shorthand, recover the instance with `implicitly[Comparator[T]]`
   inside the body, and use it to print whether `a` is smaller, equal, or
   larger than `b`. Then rewrite the same function using an explicit
   `(implicit c: Comparator[T])` parameter instead, and confirm both versions
   behave identically — this is the `htmlBoilerplate`/`htmlSugar` pair from
   lines 100-107, applied to your own type class.
