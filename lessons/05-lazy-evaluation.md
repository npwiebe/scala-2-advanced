# Lesson 5 — Lazy Evaluation

Source: `src/lectures/part2afp/LazyEvaluation.scala`

Scala is normally **strict**: when you write `val x = expr`, `expr` is
evaluated immediately, right there. This lesson covers the escape hatch —
`lazy val` — and its close cousin, call-by-name parameters, which delay
evaluation and change *when* (and *how many times*) code actually runs.

## 1. `lazy val`: the initializer runs on first use, not on declaration

```scala
lazy val x: Int = {
  println("hello")
  42
}
println(x)
println(x)
```
(lines 9-14)

If `x` were a plain `val`, `"hello"` would print immediately when the line
`lazy val x: Int = { ... }` executes, before either `println(x)` call. With
`lazy`, nothing happens at the declaration site — the block is stashed away
unevaluated. The first time `x` is actually *read* (the first `println(x)`),
the block runs, prints `"hello"`, and `x` becomes `42`. Running this file
prints:

```
hello
42
42
```

Notice `"hello"` only prints once, even though `x` is read twice.

## 2. Evaluated once and cached

Once a lazy val's initializer has run, Scala remembers the result and never
re-runs the block — every subsequent read just returns the cached value.
That's why the second `println(x)` above prints `42` without printing
`"hello"` again. Under the hood the compiler generates a private boolean
flag ("has this been initialized?") plus a private field, and the getter
checks the flag before deciding whether to run the initializer. This
one-time-then-cached behavior is what distinguishes `lazy val` from a
by-name parameter or a `def` (both of which re-run their body on *every*
access) — see section 4.

## 3. Side effects and short-circuiting: laziness can skip work entirely

```scala
def sideEffectCondition: Boolean = {
  println("Boo")
  true
}
def simpleCondition: Boolean = false

lazy val lazyCondition = sideEffectCondition
println(if (simpleCondition && lazyCondition) "yes" else "no")
```
(lines 18-25)

`&&` short-circuits: if the left operand is `false`, Scala never evaluates
the right operand at all. Here `simpleCondition` is `false`, so
`lazyCondition` is never read — which means its initializer
(`sideEffectCondition`, with the `println("Boo")` side effect) never runs.
`"Boo"` is **not** printed. If `lazyCondition` had instead been a plain
`val`, `sideEffectCondition` would have already run (and printed `"Boo"`)
the moment the `val` was declared, regardless of whether `&&` ever looked at
it. This is the practical payoff of laziness: you can wire up an expensive
or side-effecting computation and trust that it only actually runs if/when
something demands its value.

## 4. Call-by-name parameters (`=> Int`) vs. call-by-value (`Int`)

```scala
def byNameMethod(n: => Int): Int = {
  // CALL BY NEED
  lazy val t = n // only evaluated once
  t + t + t + 1
}
def retrieveMagicValue = {
  // side effect or a long computation
  println("waiting")
  Thread.sleep(1000)
  42
}

println(byNameMethod(retrieveMagicValue))
```
(lines 28-40)

A parameter typed `n: => Int` (note the `=>`, no parens) is **call by
name**: the caller doesn't hand over a computed `Int`, it hands over the
*unevaluated expression* `retrieveMagicValue`. Each time `n` is used inside
`byNameMethod`, that expression is re-run from scratch. Written naively as
`n + n + n + 1`, this method would call `retrieveMagicValue` three separate
times — printing `"waiting"` three times and sleeping three seconds total.

The fix in the source is exactly the pattern this lesson is building toward:
`lazy val t = n`. Assigning the by-name parameter to a lazy val forces it to
evaluate on first use and then **caches** that result, so the two remaining
uses of `t` are free. This combo — take a call-by-name argument, immediately
stash it in a `lazy val` — is called **call by need**: the argument is (a)
not evaluated at all if it's never used, and (b) evaluated at most once if
it is used. Running `byNameMethod(retrieveMagicValue)` prints `"waiting"`
once, sleeps one second, and returns `42*3 + 1 = 127`.

Gotcha: call-by-name (`=> Int`) and call-by-value (`Int`) look almost
identical at the call site — `byNameMethod(retrieveMagicValue)` doesn't
change no matter which one the method uses — but they behave completely
differently once the parameter is used more than once, or not at all,
inside the method body. Always check the signature, not the call site.

## 5. `withFilter`: lazy vals power efficient filtering

```scala
def lessThan30(i: Int): Boolean = { println(s"$i is less than 30?"); i < 30 }
def greaterThan20(i: Int): Boolean = { println(s"$i is greater than 20?"); i > 20 }

val numbers = List(1, 25, 40, 5, 23)
val lt30 = numbers.filter(lessThan30)   // eagerly builds an intermediate List
val gt20 = lt30.filter(greaterThan20)
println(gt20)

val lt30lazy = numbers.withFilter(lessThan30)   // lazy vals under the hood
val gt20lazy = lt30lazy.withFilter(greaterThan20)
gt20lazy.foreach(println)
```
(lines 44-62)

`.filter` is eager: `numbers.filter(lessThan30)` walks the *whole* list and
builds a complete intermediate `List` before `greaterThan20` ever runs on
it. `.withFilter` instead returns a lightweight wrapper (`FilterMonadic`)
that records the predicate but doesn't apply it yet — internally it holds
onto the source collection and predicate the way a lazy val holds onto an
unevaluated block. The actual filtering + subsequent operations (`map`,
`foreach`, chained `withFilter`) only happen, element by element, when a
terminal operation like `foreach` finally forces evaluation. This avoids
allocating the intermediate collection `lt30` entirely and lets each element
run through *all* the chained predicates before moving to the next element,
rather than one predicate across the whole list at a time.

## 6. For-comprehensions with guards desugar to `withFilter`

```scala
for {
  a <- List(1,2,3) if a % 2 == 0 // use lazy vals!
} yield a + 1
// desugars to:
List(1,2,3).withFilter(_ % 2 == 0).map(_ + 1)
```
(lines 65-68)

This is why the `if` guard inside a `for`-comprehension is efficient: the
compiler doesn't rewrite it into `.filter(...).map(...)` (which would
materialize an intermediate collection), it rewrites it into
`.withFilter(...).map(...)`, riding on the same lazy-evaluation machinery
from section 5.

## Key takeaway

`lazy val` defers a computation until its value is first *read*, then caches
the result forever — turning a side-effecting or expensive block into
something that runs at most once, and only if actually needed. This same
idea shows up disguised in several places you already know: `&&`/`||`
short-circuiting skips evaluation entirely; call-by-name parameters
(`=> Int`) re-evaluate their expression on every use unless you pin them
down with `lazy val` (giving you "call by need"); and `withFilter` /
for-comprehension guards use lazy wrappers instead of eager `List`s to avoid
building throwaway intermediate collections. The stubbed-out `MyStream` at
the end of the file (lines 78-97) is the natural next step: a singly-linked
structure where `tail` is a `lazy val`, letting you represent and consume
**infinite** sequences safely.

---

## Exercises

Try these in a scratch file:

1. Write `def countdown(n: => Int): Int` (call-by-name) that uses the
   parameter three times. Call it with an argument that has a `println`
   side effect and observe the side effect firing three times. Then fix it
   with a single `lazy val` inside the method and confirm the side effect
   now fires only once.
2. Write two boolean-returning functions with `println` side effects,
   `isEven(n: Int)` and `isPositive(n: Int)`. Build a `lazy val` from one of
   them and combine both inside an `if (a || b)` where `a` is a plain
   (non-lazy) call and `b` is your lazy val. Predict, then verify, which
   `println`s actually fire depending on whether `a` is `true` or `false`.
3. (Harder) Implement the `MyStream.from` method stubbed out at the end of
   `LazyEvaluation.scala` (or a simplified version with just `head`, `tail`,
   and `take`), making `tail` a `lazy val` inside your concrete
   subclass. Confirm you can call
   `MyStream.from(1)(_ + 1).take(5).foreach(println)` without the program
   hanging, even though the stream is conceptually infinite.
