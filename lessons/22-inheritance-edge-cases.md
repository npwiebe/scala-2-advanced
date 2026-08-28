# Lesson 22 — Inheritance Edge Cases

Source: `src/lectures/part5ts/RockingInheritance.scala`

Scala lets a class mix in multiple traits (`class Foo extends A with B with C`),
which raises the same question Java asks about multiple inheritance: if two
supertypes define the same method, which one wins? Scala answers this with a
deterministic algorithm called **trait linearization**, and this lesson is
about the sometimes-surprising consequences of that algorithm.

## 1. Compound types with `with` (not just for classes)

```scala
def processStream[T](stream: GenericStream[T] with Writer[T] with Closeable): Unit = {
  stream.foreach(println)
  stream.close(0)
}
```
(lines 20-23) A parameter type can require an object that satisfies *several*
unrelated traits at once, using `with` as a type-level "and". `stream` isn't
declared as some named combined type — it's just typed inline as the
intersection of `GenericStream[T]`, `Writer[T]`, and `Closeable`. This is the
same `with` keyword used for mixing in traits on a class; here it's used
purely as a type constraint, with no linearization concerns because nothing
is being instantiated.

## 2. The diamond problem — last override wins

```scala
trait Animal { def name: String }
trait Lion extends Animal { override def name: String = "lion" }
trait Tiger extends Animal { override def name: String = "tiger" }
class Mutant extends Lion with Tiger

val m = new Mutant
println(m.name) // "tiger"
```
(lines 27-33) `Mutant` inherits `name` from both `Lion` and `Tiger`, which
both override the same abstract method from their common ancestor `Animal`.
Java would call this illegal ("inherits unrelated defaults") or need an
explicit resolution; Scala just picks a winner deterministically: **the
trait listed last in the `with` chain wins**, because it sits closest to the
subclass in the linearization order (more on that below). Flip the order to
`class Mutant extends Tiger with Lion` and `m.name` becomes `"lion"`.

Gotcha: "last wins" is a simplification of a general rule (linearization),
but for the simple case of two sibling traits overriding the same member
with no `super` calls involved, it's the practical takeaway: **whichever
trait appears rightmost in the `extends ... with ... with ...` list is the
one whose implementation survives.**

## 3. Linearization: the real algorithm behind `super`

```scala
trait Cold  { def print = println("cold") }
trait Green extends Cold { override def print: Unit = { println("green"); super.print } }
trait Blue  extends Cold { override def print: Unit = { println("blue");  super.print } }
class Red   { def print = println("red") }
class White extends Red with Green with Blue {
  override def print: Unit = { println("white"); super.print }
}

val color = new White
color.print
```
(lines 45-75) Running this prints:
```
white
blue
green
cold
```
`"red"` never gets printed — `Red.print` is dead code for this call chain,
even though `Red` is `White`'s actual superclass. This is the crucial
insight: **`super` inside a trait does not necessarily call the method on
the trait's own declared parent.** It calls the method on *whatever type
comes next in the concrete class's linearization order*, and that order is
computed from the full `extends`/`with` list of the class being
instantiated — not from each trait in isolation.

Scala computes a linear order ("linearization") of all ancestors for
`White` by walking the `with` list right-to-left and merging each trait's
own linearization in, dropping earlier duplicates. For `class White extends
Red with Green with Blue`, that produces:

```
White -> Blue -> Green -> Cold -> Red -> AnyRef
```

Notice `Cold` (reached only through `Green`/`Blue`) is slotted in *before*
`Red`, even though textually `Red` is the direct superclass and `Cold` is
just a trait mixed in afterward. `super.print` always resolves to "the next
type to the right in this linearized chain," which is why:
- `White.print` → `super` is `Blue`
- `Blue.print` → `super` is `Green` (not `Cold`, even though `Blue extends
  Cold` directly — the chain follows the *linearization*, not the
  declaration)
- `Green.print` → `super` is `Cold` (the next entry in the chain)
- `Cold.print` doesn't call `super`, so the chain stops there, and `Red`
  is never reached.

Gotcha: this means adding a trait to a `with` list, or reordering the
traits, can silently change which superclass method actually executes —
even a method on your literal named superclass can become unreachable.
Always think in terms of "what's the linearization of *this concrete
class*," not "what does this one trait extend."

## Key takeaway

Multiple inheritance in Scala is always resolved by linearizing the full
inheritance graph of the concrete class into one line, right-to-left through
the `with` list. "Last trait wins" for overriding the same member (the
diamond problem) and "`super` calls the next entry in the linearized chain"
(not the trait's own declared parent) are two faces of the same mechanism.
Because the linearization order depends on the *whole* mixin list, changing
that order — adding a trait, reordering traits — can change both which
override wins and which `super` chain actually runs, sometimes making a
supertype's method completely unreachable (as `Red.print` is here). When
debugging "why did the wrong method run," write out the linearization order
first.

---

## Exercises

1. Take the `White`/`Red`/`Green`/`Blue`/`Cold` example and change the
   declaration to `class White extends Red with Blue with Green` (swap the
   order of the last two traits). Predict the printed output by re-deriving
   the linearization, then run it to check.
2. Add a fourth trait `Warm extends Cold` with its own `print` that prints
   `"warm"` then calls `super.print`, and mix it in as
   `class White extends Red with Green with Blue with Warm`. Work out where
   `Warm` lands in the linearization and what the full printed sequence
   is before running it.
3. Reproduce the diamond problem (`Lion`/`Tiger`/`Mutant`) but give `Tiger`
   an override that calls `super.name` instead of returning a literal.
   Since `super.name` in a trait resolves via linearization rather than
   `Animal` directly, figure out (and verify) what it prints when `Mutant`
   is `class Mutant extends Lion with Tiger`.
