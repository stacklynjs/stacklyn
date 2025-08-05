# Contributing to Stacklyn

First off, thank you for wanting to help out :D

## Getting Started

```bash
git clone https://github.com/stacklynjs/stacklyn.git
```

Then do your changes, simple as that!

To build `stacklyn.min.js`, you can do either:
- `node build.js` (fast and direct)
- `npm run build` (standard, but slower imo)

Both go to build.js anyway.

If you're wondering why `dist` only has one lone file, it's for future proofing in case someone says "make an es6 polyfill version pls".

## What to avoid

Please avoid suggesting, or making PRs that:
- Add support for a JS engine no one uses
  - **optional but recommended:**
    If it can't run Stacklyn feasibly (e.g. you *have* to do some steps before getting to do anything) then that JS engine would also be discarded.
- Add parsing for formats that are undetectable, exactly the same, or too similar to a format already parsed
    - E.g. a format that starts with four spaces and an at. This is already handled and the PR will get closed.
    - If the trace format has special marks like `<unknown>` you could put an `if` statement in the parser at MOST.
      - While those cases are fine, if there's trace formats of different engines that have the same marks, don't add detection for them.
- Add features unrelated to the core purpose (error handling or stack traces)
- Introduce frameworks or dependencies (Stacklyn is meant to be zero-dependency)
- Format the code in an unnecessary way or dont fit the style guide listed below

## Style Guide
This is meant to be a guide, but it's heavily recommended you follow this for your PRs to get accepted.

- Use 4 spaces for indentation.
- Try to keep lines under 100 characters.
- Prefer readable code when possible
- Include semicolons at the end of statements where possible
- Don't explain the obvious, for example:
  ```js
  function addNumbers(a, b) { // defines a function called addNumbers that takes a and b
      return a + b; // adds a and b together and returns the result
  } // end of function
  ```
  Your code should generally be able to explain itself.
- Minimize empty lines unless they break up logic meaningfully.

## Testing
There's no test suite, but here's how I tested my stuff:

1. Chrome can hide bugs, so I tried the code on Firefox and Node.
2. If it works the same way in both, your change is good to go!

## Known Issues
Not everything is perfect, Stacklyn has bugs too.  
Luckily they're not the game-over bugs, they're little edge cases I'm just not wanting to deal with at the moment as they require complex solutions.

### 1. Eval-to-eval conversions result in malformed frames
I can't easily convert between both eval formats at the moment.  
Eval stack traces are complicated, no matter how easy it seems on the surface.  
  
If you find a solution, make a PR!  
The issue number is #1.

### 2. When parsing Opera/Espruino stack traces, lines with `\n` inside strings or comments get split incorrectly.
This sounds like a simple issue but I have no idea how it'd be fixed.

Those are the ones I know about at the moment, they're marked with `// BUG:` so you can easily find them!

## Bugs and Suggestions

If you find a bug or want to suggest something to be in the next version, feel free to open an issue. I'll respond when possible!

If you're reporting a bug with an existing parser or converter, include a sample stack trace.
Also, try to use labels when creating PRs or issues.

### Want to maintain Stacklyn?
I don't want to be the only maintainer, if you want to help make Stacklyn better, email me at `stacklynjs@proton.me` and I'll look into it!

Thanks for helping improve Stacklyn, you're awesome :D