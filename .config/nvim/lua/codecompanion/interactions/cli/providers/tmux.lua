local config = require("codecompanion.config")
local log = require("codecompanion.utils.log")

local api = vim.api

---@class CodeCompanion.CLI.Provider
---@field agent table
---@field attach_chan number|nil
---@field bufnr number
---@field pane_id string|nil
---@field ready boolean
---@field session_name string
---@field tmux { bin: string, session_prefix: string }
local Tmux = {}

---@param value string
---@return string
local function sanitize(value)
  return value:gsub("[^%w_-]", "-")
end

---@param args { bufnr: number, agent: table }
---@return CodeCompanion.CLI.Provider
function Tmux.new(args)
  local provider = config.interactions.cli.providers.tmux or {}
  local opts = provider.opts or {}
  local agent_name = sanitize(args.agent.description or args.agent.cmd or "cli")
  local session_prefix = sanitize(opts.session_prefix or "codecompanion")

  local self = setmetatable({
    agent = args.agent,
    attach_chan = nil,
    bufnr = args.bufnr,
    pane_id = nil,
    ready = false,
    session_name = string.format("%s-%s-%d", session_prefix, agent_name, args.bufnr),
    tmux = {
      bin = opts.bin or "tmux",
      session_prefix = session_prefix,
    },
  }, { __index = Tmux })
  ---@cast self CodeCompanion.CLI.Provider

  return self
end

---@private
---@param args string[]
---@param opts? { stdin?: string, timeout?: integer, suppress_errors?: boolean }
---@return vim.SystemCompleted
function Tmux:_run(args, opts)
  opts = opts or {}

  local result = vim.system(vim.list_extend({ self.tmux.bin }, args), {
    stdin = opts.stdin,
    text = true,
  }):wait(opts.timeout or 5000)

  if result.code ~= 0 and not opts.suppress_errors then
    log:debug("tmux command failed: %s", table.concat(args, " "))
    if result.stderr and result.stderr ~= "" then
      log:debug(result.stderr)
    end
  end

  return result
end

---@return boolean
function Tmux:start()
  if vim.fn.executable(self.tmux.bin) ~= 1 then
    log:error("tmux executable `%s` was not found", self.tmux.bin)
    return false
  end

  local cmd = vim.deepcopy(self.agent.args or {})
  table.insert(cmd, 1, self.agent.cmd)

  local started = self:_run(vim.list_extend({
    "new-session",
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-s",
    self.session_name,
    "-c",
    vim.fn.getcwd(),
  }, cmd))

  if started.code ~= 0 then
    log:error("Failed to start tmux-backed CLI agent: %s", started.stderr or "unknown error")
    return false
  end

  self.pane_id = vim.trim(started.stdout or "")
  if self.pane_id == "" then
    log:error("Failed to resolve tmux pane for CLI agent")
    return false
  end

  local ok, err = pcall(function()
    api.nvim_buf_call(self.bufnr, function()
      self.attach_chan = vim.fn.jobstart({
        "env",
        "-u",
        "TMUX",
        self.tmux.bin,
        "attach-session",
        "-t",
        self.session_name,
      }, {
        term = true,
        cwd = vim.fn.getcwd(),
        on_exit = function(_, exit_code, _)
          log:debug("tmux attach exited with code %d", exit_code)
          self.attach_chan = nil
          self.ready = false
        end,
      })
    end)
  end)

  if not ok then
    log:error("Failed to attach tmux CLI agent: %s", err)
    self:stop()
    return false
  end

  if not self.attach_chan or self.attach_chan <= 0 then
    self:stop()
    return false
  end

  self.ready = true
  return true
end

---@param text string
---@param opts? { submit: boolean }
---@return boolean
function Tmux:send(text, opts)
  if not self:is_running() or not self.pane_id then
    log:warn("CLI agent is not running")
    return false
  end

  local normalized = text:gsub("\r\n", "\n")
  if normalized ~= "" then
    local buffer_name = self.session_name .. "-input"
    local loaded = self:_run({ "load-buffer", "-b", buffer_name, "-" }, { stdin = normalized })
    if loaded.code ~= 0 then
      log:error("Failed to load tmux buffer for CLI input: %s", loaded.stderr or "unknown error")
      return false
    end

    local pasted = self:_run({ "paste-buffer", "-d", "-b", buffer_name, "-t", self.pane_id })
    if pasted.code ~= 0 then
      log:error("Failed to paste tmux buffer into CLI pane: %s", pasted.stderr or "unknown error")
      return false
    end
  end

  if opts and opts.submit then
    local submitted = self:_run({ "send-keys", "-t", self.pane_id, "Enter" })
    if submitted.code ~= 0 then
      log:error("Failed to submit CLI prompt via tmux: %s", submitted.stderr or "unknown error")
      return false
    end
  end

  return true
end

---@return boolean
function Tmux:is_running()
  local result = self:_run({ "has-session", "-t", self.session_name }, { suppress_errors = true })
  return result.code == 0
end

---@return nil
function Tmux:stop()
  if self.attach_chan then
    pcall(vim.fn.jobstop, self.attach_chan)
    self.attach_chan = nil
  end

  if self.session_name ~= "" then
    self:_run({ "kill-session", "-t", self.session_name }, { suppress_errors = true })
  end

  self.ready = false
  self.pane_id = nil
end

return Tmux
