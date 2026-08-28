# Scala 2 Advanced — Learning Roadmap

Source repo: `scala-2-advanced` (Rock the JVM, Scala 2 Advanced course — no video, code-only).
Prereq completed: `scala-learning-intellij` (basics: expressions, OOP, FP basics, pattern matching).

Each lesson gets its own file here: `NN-topic.md`, with explanation, annotated examples
(referencing the real source file + line numbers), and practice exercises.

## Status

| # | Topic | Source file | Status |
|---|-------|-------------|--------|
| 0 | Background: `Option` (not in course, gap-filler) | n/a | ✅ done |
| 1 | Dark syntax sugars | `part1as/DarkSugars.scala` | ✅ done |
| 2 | Advanced pattern matching | `part1as/AdvancedPatternMatching.scala` | ✅ done |
| 3 | Partial functions | `part2afp/PartialFunctions.scala` | ✅ done |
| 4 | Currying & PAF (partially applied functions) | `part2afp/CurriesPAF.scala` | ✅ done |
| 5 | Lazy evaluation | `part2afp/LazyEvaluation.scala` | ✅ done |
| 6 | Monads | `part2afp/Monads.scala` | ✅ done |
| 7 | Exercise: Streams | `exercises/StreamsPlayground.scala` | ✅ done |
| 8 | Concurrency intro (Threads) | `part3concurrency/Intro.scala` | ✅ done |
| 9 | Thread communication (wait/notify) | `part3concurrency/ThreadCommunication.scala` | ✅ done |
| 10 | Futures & Promises | `part3concurrency/FuturesPromises.scala` | ✅ done |
| 11 | Parallel utils | `part3concurrency/ParallelUtils.scala` | ✅ done |
| 12 | Implicits intro | `part4implicits/ImplicitsIntro.scala` | ✅ done |
| 13 | Organizing implicits | `part4implicits/OrganizingImplicits.scala` | ✅ done |
| 14 | Pimp my library (implicit classes) | `part4implicits/PimpMyLibrary.scala` | ✅ done |
| 15 | Type classes | `part4implicits/TypeClasses.scala` | ✅ done |
| 16 | Exercise: Equality type class | `exercises/EqualityPlayground.scala` | ✅ done |
| 17 | Type class template | `part4implicits/MyTypeClassTemplate.scala` | ✅ done |
| 18 | Scala/Java conversions | `part4implicits/ScalaJavaConversions.scala` | ✅ done |
| 19 | Magnet pattern | `part4implicits/MagnetPattern.scala` | ✅ done |
| 20 | JSON serialization (implicits case study) | `part4implicits/JSONSerialization.scala` | ✅ done |
| 21 | Exercise: MySet (functional set) | `exercises/MySet.scala` | ✅ done |
| 22 | Inheritance edge cases | `part5ts/RockingInheritance.scala` | ✅ done |
| 23 | Self types | `part5ts/SelfTypes.scala` | ✅ done |
| 24 | Path-dependent types | `part5ts/PathDependentTypes.scala` | ✅ done |
| 25 | Type members | `part5ts/TypeMembers.scala` | ✅ done |
| 26 | Variance | `part5ts/Variance.scala` | ✅ done |
| 27 | F-bounded polymorphism | `part5ts/FBoundedPolymorphism.scala` | ✅ done |
| 28 | Structural types | `part5ts/StructuralTypes.scala` | ✅ done |
| 29 | Higher-kinded types | `part5ts/HigherKindedTypes.scala` | ✅ done |
| 30 | Reflection | `part5ts/Reflection.scala` | ✅ done |

## How we work

- One lesson at a time. I explain the concept, walk the real source file, give you
  small exercises, and you try them before moving on.
- Progress is tracked in this table — update the Status column as we go so a future
  session can pick up where we left off.
- All 31 lesson files (0-30) are written in full. Work through them in order; each
  builds on terminology/patterns established in earlier ones (implicits especially —
  lessons 12-20 form one continuous arc). Do the Exercises section at the end of each
  before moving to the next.
