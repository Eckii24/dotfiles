return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        ast_grep = {
          mason = false,
          cmd = {
            "ast-grep",
            "lsp",
            "--config",
            vim.fn.expand("~/.config/code-policy/sgconfig.yml"),
          },
          root_markers = { ".git" },
        },
      },
    },
  },
}
