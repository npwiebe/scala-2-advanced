# Lesson 23 — Self Types

Source: `src/lectures/part5ts/SelfTypes.scala`

Self types let a trait declare "whoever eventually mixes me into a concrete
class must *also* mix in this other type." It looks like inheritance syntax
but it is a completely different relationship: a **constraint on
implementers**, not an **is-a** relationship. That distinction is the whole
lesson.

## 1. The self-type syntax: `this: SomeType =>`

```scala
trait Instrumentalist {
  def play(): Unit
}

trait Singer { this: Instrumentalist => // SELF TYPE: whoever implements Singer must also implement Instrumentalist
  def sing(): Unit
}

class LeadSinger extends Singer with Instrumentalist {
  override def play(): Unit = ???
  override def sing(): Unit = ???
}
```
(`SelfTypes.scala:10-23`) `this: Instrumentalist =>` inside `Singer` doesn't
make `Singer` extend `Instrumentalist`. It's a promise from `Singer` to the
compiler: "I might call `Instrumentalist` methods internally (I don't here,
but I legally could), so you're only allowed to instantiate me alongside an
`Instrumentalist`." Because `LeadSinger` mixes in both `Singer with
Instrumentalist`, the constraint is satisfied and it compiles.

Once inside `Singer`'s body, the self type also means you get access to
`Instrumentalist`'s members (e.g. you could write `def sing(): Unit = play()`
inside `Singer` even though `Singer` never extends `Instrumentalist`) — the
self type both *grants access* to the required type's API and *demands* the
final class provide it.

**Gotcha** — the commented-out counter-example makes the constraint concrete:

```scala
//  class Vocalist extends Singer {
//    override def sing(): Unit = ???
//  }
```
(`SelfTypes.scala:25-27`) This does not compile. `Vocalist` mixes in `Singer`
but never mixes in `Instrumentalist`, so the compiler rejects it with
something like "illegal inheritance; self-type `Singer` does not conform to
`Instrumentalist`." The self type is checked at the point something becomes
concrete/instantiable — you can write more traits depending on `Singer`
freely, but the moment a real class (or anonymous class) tries to close the
loop, the requirement must be satisfied somewhere in the mix-in chain.

## 2. Anonymous classes and order-independence

```scala
val jamesHetfield = new Singer with Instrumentalist {
  override def play(): Unit = ???
  override def sing(): Unit = ???
}

class Guitarist extends Instrumentalist {
  override def play(): Unit = println("(guitar solo)")
}

val ericClapton = new Guitarist with Singer {
  override def sing(): Unit = ???
}
```
(`SelfTypes.scala:29-40`) `jamesHetfield` satisfies the requirement inline
with an anonymous class, the same way `LeadSinger` did. `ericClapton` shows
the requirement doesn't care *how* `Instrumentalist` gets satisfied or in
what order the traits appear — `Guitarist` already provides `play()` by
extending `Instrumentalist`, so stacking `with Singer` on top is legal even
though `Guitarist` itself was defined and compiled with no knowledge of
`Singer`. The self type is resolved structurally at the final composition
point, not by rigid subtype chains.

## 3. Self types vs. inheritance — get the relationship right

```scala
class A
class B extends A // B IS AN A

trait T
trait S { self: T => } // S REQUIRES a T
```
(`SelfTypes.scala:42-47`) This is the core distinction, spelled out directly
in the comments:

- `extends` establishes a genuine **subtype** relationship. Every `B` *is
  an* `A` — you can pass a `B` anywhere an `A` is expected, and `B`
  inherits `A`'s implementation for free without any extra declaration at
  the use site.
- A self type establishes a **dependency**, not a subtype relationship. `S`
  is not a `T` and cannot be used where a `T` is expected. It only says "any
  concrete thing that ends up being an `S` must, *separately*, also be a
  `T`." The two types remain unrelated in the type hierarchy — the
  constraint is enforced only at the moment of instantiation/mixing, and
  `self`/`this` inside `S`'s body is just an alias giving you access to
  `T`'s members, not proof that `S <: T`.

## 4. The cake pattern — compile-time dependency injection

```scala
// DI
class Component {
  // API
}
class ComponentA extends Component
class ComponentB extends Component
class DependentComponent(val component: Component)
```
(`SelfTypes.scala:52-57`) Traditional (runtime) DI passes a dependency in
through a constructor. The consumer holds a reference and calls through it —
nothing stops you from passing the wrong implementation, and the wiring is
checked (if at all) at runtime.

```scala
trait ScalaComponent {
  def action(x: Int): String
}
trait ScalaDependentComponent { self: ScalaComponent =>
  def dependentAction(x: Int): String = action(x) + " this rocks!"
}
trait ScalaApplication { self: ScalaDependentComponent => }

// layer 1 - small components
trait Picture extends ScalaComponent
trait Stats extends ScalaComponent

// layer 2 - compose
trait Profile extends ScalaDependentComponent with Picture
trait Analytics extends ScalaDependentComponent with Stats

// layer 3 - app
trait AnalyticsApp extends ScalaApplication with Analytics
```
(`SelfTypes.scala:60-78`) The "cake pattern" replaces constructor injection
with self types stacked across layers, checked entirely by the compiler:

- `ScalaDependentComponent` calls `action(x)` directly inside
  `dependentAction`, without importing/constructing a `ScalaComponent` —
  the self type gives it that access.
- Each layer only declares the *next* dependency it needs
  (`ScalaApplication` needs a `ScalaDependentComponent`, which in turn needs
  a `ScalaComponent`), and lets whoever assembles the final "cake"
  (`AnalyticsApp`) supply a concrete chain: `Analytics` supplies the
  `ScalaDependentComponent` requirement via `extends ScalaDependentComponent
  with Stats`, and `Stats extends ScalaComponent` supplies `action`.
- If any layer of the cake is missing (e.g. you forgot `with Stats`
  somewhere), you get a compile error, not a runtime `NullPointerException`
  or wrong-implementation bug — the same guarantee `Vocalist` failed to
  meet in section 1, just composed across several layers instead of one.

**Key takeaway**: a self type is a compile-time-checked promise ("whoever I
end up being mixed into must also be a `T`"), not a subtyping relationship.
It gives the trait body access to the required type's members while keeping
the two types unrelated in the hierarchy, and it's enforced lazily — only
when something concrete/instantiable tries to close the requirement chain.
The cake pattern exploits this to wire dependencies through layered traits
entirely at compile time, catching missing wiring as a compile error instead
of a runtime failure.

## 5. Self types enable dependencies plain inheritance can't express

```scala
trait X { self: Y => }
trait Y { self: X => }
```
(`SelfTypes.scala:87-88`) This compiles. `X` requires a `Y` and `Y` requires
an `X` — a mutual dependency. The equivalent with real inheritance,
```scala
//  class X extends Y
//  class Y extends X
```
(`SelfTypes.scala:84-85`, commented out because it's illegal) is a genuine
cyclic-inheritance error: the compiler must linearize a class's supertype
chain, and `X extends Y extends X extends ...` never terminates. Self types
don't have this problem precisely *because* they aren't inheritance — no
linearized hierarchy needs to be built, just a pairwise "this mix-in must
also carry that mix-in" requirement, which is only checked once something
concrete provides both `X` and `Y` traits together. That's the deeper reason
self types exist as a separate mechanism rather than "extends with extra
steps": they can express mutual/cyclical requirements between traits that
`extends` structurally cannot.

---

## Exercises

1. Reproduce the `Singer`/`Instrumentalist` example but with three traits:
   `Drummer`, `Percussionist { self: Drummer => }`, and a third trait
   `BandLeader { self: Percussionist with Drummer => }`. Write a concrete
   class that legally mixes in all three, then comment out one of the
   `with` clauses and confirm the compiler error names the missing self
   type.
2. Build your own mini cake: a `Logger` component trait with
   `def log(msg: String): Unit`, a `Service { self: Logger => }` trait with a
   `def process(x: Int): Int = { log(s"processing $x"); x * 2 }`, and a
   `ConsoleLogger extends Logger` implementation. Assemble
   `class RealService extends Service with ConsoleLogger` and call
   `process`.
3. Write two mutually dependent traits `Parser { self: Validator => }` and
   `Validator { self: Parser => }`, each with one abstract method that calls
   the other's method. Then try (and fail) to write the same relationship
   using two classes and `extends` in both directions — capture the
   compiler error message you get and explain in a comment why self types
   avoid it.
