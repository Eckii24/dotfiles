-- Track LazyVim on latest main instead of stable tag.
-- Must be in lua/plugins/ so this fragment loads AFTER lazyvim.plugins,
-- overriding its internal `version = "*"`.
return {
  { "LazyVim/LazyVim", version = false },
}
