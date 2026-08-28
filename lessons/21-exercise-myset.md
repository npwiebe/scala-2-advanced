# Lesson 21 — Exercise: MySet

Source: `src/exercises/MySet.scala`

You already know a set as "a collection with no duplicates." This exercise
throws away the collection and represents a `Set[A]` as **a function that
decides membership** — `A => Boolean`. Everything else (union, intersection,
map, filter...) is derived by combining those predicates. This is the same
idea as `PartialFunction`/`Function1` from earlier lessons, pushed all the way
to "the data structure basically *is* a function."

## 1. A set is a predicate, not a container

```scala
trait MySet[A] extends (A => Boolean) {
  def apply(elem: A): Boolean = contains(elem)
  def contains(elem: A): Boolean
  ...
}
```
(`src/exercises/MySet.scala:8-14`)

`MySet[A]` extends `A => Boolean` directly. `apply` (the thing that makes an
instance callable like `mySet(3)`) just delegates to `contains`. So `mySet(3)`
and `mySet.contains(3)` are the same call — the set *is* its own membership
test, which is why `filter(!anotherSet)` later on can pass a whole `MySet` in
wherever a predicate `A => Boolean` is expected (Lesson-1 SAM-style thinking:
a one-abstract-method type is interchangeable with a function).

## 2. The two concrete representations: list-like and property-based

There are two implementations of `MySet`, and the split is the crux of the
whole exercise:

```scala
class NonEmptySet[A](head: A, tail: MySet[A]) extends MySet[A] {
  def contains(elem: A): Boolean = elem == head || tail.contains(elem)
  ...
}
```
(`src/exercises/MySet.scala:84-86`)

`NonEmptySet` stores elements explicitly, cons-list style (`head`/`tail`,
exactly like `MyList` from earlier exercises) — this is what you get from
`MySet(1,2,3)`.

```scala
// all elements of type A which satisfy a property
// { x in A | property(x) }
class PropertyBasedSet[A](property: A => Boolean) extends MySet[A] {
  def contains(elem: A): Boolean = property(elem)
  ...
}
```
(`src/exercises/MySet.scala:58-61`)

`PropertyBasedSet` stores *no elements at all* — just a predicate. This is
what shows up when a set operation can't be expressed as a finite list, most
importantly negation (section 5). It's the set-builder notation `{x ∈ A |
P(x)}` made literal in code.

## 3. `+` and `++`: adding without mutating

```scala
def +(elem: A): MySet[A] =
  if (this contains elem) this
  else new NonEmptySet[A](elem, this)
```
(`src/exercises/MySet.scala:88-90`)

Adding to a `NonEmptySet` just wraps the current set as the new `tail` behind
a fresh `head` — no mutation, no duplicate check needed beyond "don't bother
prepending if it's already in there." The `PropertyBasedSet` version has no
elements to prepend to, so it does it algebraically instead:

```scala
// { x in A | property(x) } + element = { x in A | property(x) || x == element }
def +(elem: A): MySet[A] =
  new PropertyBasedSet[A](x => property(x) || x == elem)
```
(`src/exercises/MySet.scala:62-64`)

Same idea for union (`++`) — `NonEmptySet` recurses element-by-element
(`tail ++ anotherSet + head`, see the trace comment at
`src/exercises/MySet.scala:92-98`), while `PropertyBasedSet` just ORs the two
predicates together:

```scala
def ++(anotherSet: MySet[A]): MySet[A] =
  new PropertyBasedSet[A](x => property(x) || anotherSet(x))
```
(`src/exercises/MySet.scala:67-68`)

Both are "the same set," described two different ways: a finite enumeration,
or a rule for testing any candidate element.

## 4. `map`/`flatMap`/`filter`/`foreach` on `NonEmptySet`

```scala
def map[B](f: A => B): MySet[B] = (tail map f) + f(head)
def flatMap[B](f: A => MySet[B]): MySet[B] = (tail flatMap f) ++ f(head)
def filter(predicate: A => Boolean): MySet[A] = {
  val filteredTail = tail filter predicate
  if (predicate(head)) filteredTail + head
  else filteredTail
}
def foreach(f: A => Unit): Unit = { f(head); tail foreach f }
```
(`src/exercises/MySet.scala:102-113`)

Structurally identical to the recursive `MyList` implementations from the
earlier collections exercise: process `head`, recurse on `tail`, recombine
with `+`/`++`. `map`/`flatMap` on a set can produce duplicates (`{1,2} map (_
% 2)` gives `0` twice), but `+` silently absorbs the repeat via its
`contains` check in section 3 — so "no duplicates" falls out of the `+`
implementation for free, not from any dedup step in `map`.

### Gotcha: `map`/`flatMap`/`foreach` are undefined on `PropertyBasedSet`

```scala
def map[B](f: A => B): MySet[B] = politelyFail
def flatMap[B](f: A => MySet[B]): MySet[B] = politelyFail
def foreach(f: A => Unit): Unit = politelyFail

def politelyFail = throw new IllegalArgumentException("Really deep rabbit hole!")
```
(`src/exercises/MySet.scala:71-73, 81`)

You can't enumerate "all integers satisfying some property" to apply `f` to
each one — there may be infinitely many, and even if finite, there's no
algorithm here to find them from the predicate alone. `contains`, `filter`,
`+`, `++`, `-`, `&`, `--`, and `unary_!` all work fine because they only ever
need to *evaluate* the predicate at specific points, never *enumerate* its
solution set. `map`/`flatMap`/`foreach` need enumeration, so they throw. This
is the honest cost of representing a set as `A => Boolean` instead of a real
collection.

## 5. Complement via `unary_!` — the set that has no elements to list

```scala
// EXERCISE #3 - implement a unary_! = NEGATION of a set
def unary_! : MySet[A]
```
(`src/exercises/MySet.scala:35-37`)

```scala
def unary_! : MySet[A] = new PropertyBasedSet[A](x => !this.contains(x))
```
(`src/exercises/NonEmptySet`, `src/exercises/MySet.scala:124`)

Defining a method named `unary_!` is what lets you write `!s` instead of
`s.unary_!` — the same operator-desugaring family from Lesson 1 (`apply`/
`update`, `x_=` setters). The negation of `MySet(1,2,3)` is "every A except
1, 2, and 3" — infinite for `A = Int`, so it *must* be represented as a
`PropertyBasedSet`; there's no way to list it. This is exactly why the
codebase needs two implementations instead of one: `NonEmptySet` can express
finite membership cheaply, but only `PropertyBasedSet` can express
"everything satisfying some rule," including rules with infinitely many or
zero witnesses.

The empty set's negation confirms the pattern from the other direction:

```scala
def unary_! : MySet[A] = new PropertyBasedSet[A](_ => true)
```
(`src/exercises/MySet.scala:55`, on `EmptySet`)

`!emptySet` is "the set of everything" — again unrepresentable as a list,
trivial as a predicate (`_ => true`).

## 6. `-`, `--`, `&`: subtraction, difference, and intersection as filters

```scala
def --(anotherSet: MySet[A]): MySet[A] = filter(!anotherSet)
def &(anotherSet: MySet[A]): MySet[A] = filter(anotherSet) // intersection = filtering!
```
(`src/exercises/MySet.scala:120-121`, identical logic on `PropertyBasedSet` at lines 77-78)

This is the payoff of making `MySet[A]` itself an `A => Boolean`: intersection
`A & B` is just `A.filter(B)` — "keep the elements of A that B also
contains" — because `anotherSet` can be passed directly wherever a predicate
is expected. Difference `A -- B` is `A.filter(!B)` — "keep the elements of A
that B's complement contains," i.e. that B does *not* contain. Single-element
removal (`-`) is the finite special case, recursively rebuilding
`NonEmptySet` without the target (`src/exercises/MySet.scala:116-118`), or
`filter(x => x != elem)` on the property-based side
(`src/exercises/MySet.scala:76`).

## Key takeaway

`MySet[A]` collapses "is this element in the set" and "what is this set" into
the same object, because it literally extends `A => Boolean`. Finite sets
(`NonEmptySet`/`EmptySet`) can also enumerate their elements, so they support
`map`/`flatMap`/`foreach`; sets built from a rule alone
(`PropertyBasedSet` — needed for negation, and for unions/filters against
those) can only answer "is X in here," and correctly refuse to enumerate.
Once you see intersection as "filter by the other set's predicate" and
difference as "filter by the other set's negated predicate," most of the
implementation stops looking like special-cased set algebra and starts
looking like ordinary boolean composition of functions.

---

## Exercises

1. Implement `isSubsetOf(anotherSet: MySet[A]): Boolean` on `MySet[A]` (add it
   to the trait and both concrete classes, or write it once as a default
   method in terms of existing operations — think about what "A is a subset
   of B" means as a statement about `--` or about `foreach`/`contains`).
   Careful: your implementation must not call `foreach` on a
   `PropertyBasedSet`.
2. Add a `toString` override that prints a `NonEmptySet` as `[1, 2, 3]`
   (collect elements via `foreach`), but for `PropertyBasedSet`, since you
   cannot enumerate it, print something like `{property-based set}` or
   sample-test a fixed small range (e.g. `-10` to `10`) and show which of
   those satisfy it, clearly labeled as a sample rather than the full set.
3. (Harder) Implement `isEmpty: Boolean` on `MySet[A]`. It's trivial for
   `EmptySet` and `NonEmptySet`, but think hard about what it should do for
   `PropertyBasedSet` — can it be answered correctly in general, or only in
   special cases (e.g. `!s` where you know `s` is finite)? Write down why, in
   a comment, even if your implementation has to approximate or throw.
