return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        -- Mason owns editor-local LSP binaries. Project/CI dependencies stay in uv.
        ty = {},
        ruff = {},

        -- The LazyVim Python extra configures Pyright by default. `ty` owns type
        -- diagnostics and language intelligence for our uv/Ruff/ty projects.
        pyright = {
          enabled = false,
          mason = false,
        },
      },
    },
  },
}
