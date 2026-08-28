# Lesson 24 — Path-Dependent Types

Source: `src/lectures/part5ts/PathDependentTypes.scala`

Nested classes, objects, and type members aren't just namespacing tricks. When
a type is nested inside another class, its *full identity as a type* includes
which specific outer **instance** it came from. That's what "path-dependent"
means: the type is dependent on the object *path* you took to reach it
(`o.Inner`), not just the enclosing class name.

## 1. Nesting: classes, objects, and types can all live inside a class

```scala
class Outer {
  class Inner
  object InnerObject
  type InnerType

  def print(i: Inner) = println(i)
  def printGeneral(i: Outer#Inner) = println(i)
}
```
(lines 8-15) Just like `def aMethod` can have a local `class HelperClass` and
`type HelperType = String` scoped to its body (lines 17-21), a class can host
inner classes, inner objects, and abstract type members. Nothing new so far —
but *how you refer to `Inner` from the outside* is where things get
interesting.

## 2. Per-instance types: `o.Inner` is scoped to `o`

```scala
val o = new Outer
val inner = new o.Inner // o.Inner is a TYPE

val oo = new Outer
//  val otherInner: oo.Inner = new o.Inner   // does NOT compile
```
(lines 24-28) `o.Inner` is a type — literally "the `Inner` type as it exists
on the specific instance `o`". Even though `oo` is created from the exact same
`class Outer`, `oo.Inner` and `o.Inner` are **different, incompatible types**
to the compiler. An `Outer.Inner` created via `o` cannot be assigned where an
`oo.Inner` is expected, and `o.print(inner)` typechecks (line 30) precisely
because `print` demands an `Inner` scoped to `this` (the same `o`), while
`oo.print(inner)` (line 31, commented out) fails — `oo.print` expects an
`oo.Inner`, and `inner`'s real type is `o.Inner`.

Gotcha: this looks bizarre coming from Java, where nested-class typing is
structural — `Outer.Inner` is one type regardless of which `Outer` instance
built it. Scala's path-dependent types are stricter: the type carries the
*instance path* (`o.` vs `oo.`) as part of its identity, not just the class.

## 3. Why this matters: compile-time proof that "these came from the same instance"

The practical value isn't pedantic type-checking for its own sake — it's a
free correctness guarantee. If a method signature requires an `o.Inner`, the
compiler is proving *at compile time* that whatever you pass in was built by
that exact outer instance, not just "an `Inner` from some `Outer`
somewhere." You get this guarantee without writing any runtime check.

## 4. Escaping the restriction: type projection with `Outer#Inner`

```scala
def printGeneral(i: Outer#Inner) = println(i)
...
o.printGeneral(inner)
oo.printGeneral(inner)
```
(lines 14, 36-37) Sometimes you *don't* care which specific `Outer` instance
produced the `Inner` — you just want "an `Inner` belonging to any `Outer`."
`Outer#Inner` (the `#` is called **type projection**) means exactly that: it
erases the instance-path restriction and accepts an `Inner` from *any*
`Outer`. That's why `printGeneral` happily accepts the same `inner` value
regardless of whether it's called on `o` or `oo` — both calls compile,
unlike the `print` example in section 2.

Think of `Outer#Inner` as the "class-level" view of the nested type (closer to
what Java gives you for free), and `outerInstance.Inner` as the "instance-level,
path-dependent" view. `#` projects away the path.

## 5. Motivating use case: type-safe heterogeneous key-value lookup

```scala
trait ItemLike {
  type Key
}

trait Item[K] extends ItemLike {
  type Key = K
}

trait IntItem extends Item[Int]
trait StringItem extends Item[String]

def get[ItemType <: ItemLike](key: ItemType#Key): ItemType = ???

get[IntItem](42)          // ok
get[StringItem]("home")   // ok
// get[IntItem]("scala")  // does NOT compile
```
(lines 49-65) This is the payoff. Instead of nesting a nominal class, `Key` is
an abstract **type member** on `ItemLike`, fixed to a concrete type by each
`Item[K]` subtype (`IntItem` fixes `Key = Int`, `StringItem` fixes
`Key = String`). The generic method `get[ItemType <: ItemLike]` needs to
accept a `key` whose type matches *whatever `Key` is for that particular
`ItemType`* — and `ItemType#Key` (type projection again) expresses exactly
that: "the `Key` type associated with `ItemType`, whichever `ItemType` you
plug in."

Because of this, `get[IntItem](42)` type-checks (`IntItem#Key` resolves to
`Int`), `get[StringItem]("home")` type-checks (`StringItem#Key` resolves to
`String`), and `get[IntItem]("scala")` is rejected by the compiler before the
program even runs — you can't pass a `String` key for an `Int`-keyed item.
This is the general pattern behind type-safe heterogeneous containers/APIs:
encode "the type of X depends on which variant of Y you have" as an abstract
type member plus path-dependent/projected types, and let the compiler reject
mismatches statically instead of discovering them at runtime with a
`ClassCastException`.

## Key takeaway

A type nested inside a class isn't one fixed type — `outer.Inner` is bound to
the specific `outer` instance that produced it, so two instances of the same
outer class produce two incompatible inner types. Use this when you want the
compiler to *prove* two values came from the same instance. When you instead
want to talk about "an `Inner` from any instance," use type projection,
`Outer#Inner`. Combined with abstract type members (`type Key`), path-dependent
types let you build APIs where a method's expected argument type varies with
a type parameter — enforced entirely at compile time, with zero runtime cost.

---

## Exercises

1. Write a `class Vault { class Key; def open(k: Key): String = "opened" }`.
   Create two vaults `v1` and `v2`, create a `Key` from `v1`, and confirm
   `v1.open(key)` compiles but `v2.open(key)` does not. Then add a
   `def openAny(k: Vault#Key): String` method and confirm it accepts keys
   from either vault.
2. Model a tiny type-safe "container" system: a trait `Box[T] { type Contents = T }`,
   with `IntBox extends Box[Int]` and `StringBox extends Box[String]`, and a
   method `def put[B <: Box[_]](value: B#Contents): B = ???`. Verify
   `put[IntBox](5)` compiles and `put[IntBox]("nope")` does not.
3. (Harder) Extend the `ItemLike`/`Item[K]` example from section 5 with a third
   variant, `BooleanItem extends Item[Boolean]`, and write a `get` call for it.
   Then explain in a comment why `ItemType#Key` (projection) is required here
   instead of an instance-path type like `someInstance.Key` — what instance
   would you even use, given that `get` never receives an `ItemLike` value at all?
