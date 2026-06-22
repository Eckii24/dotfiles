local M = {}

local api = vim.api

local review_file = ".ai-review.json"
local ns = api.nvim_create_namespace("diffview_ai_review_comments")
local augroup_name = "DiffviewAiReviewComments"

local function notify(message, level)
  vim.notify(message, level or vim.log.levels.INFO, { title = "AI Review" })
end

local function git_root()
  local root = vim.fn.systemlist("git rev-parse --show-toplevel")[1]

  if vim.v.shell_error == 0 and root and root ~= "" then
    return root
  end

  return vim.uv.cwd()
end

local function normalize(path)
  if not path then
    return path
  end

  path = path:gsub("\\", "/")

  if vim.fs and vim.fs.normalize then
    return vim.fs.normalize(path)
  end

  return path
end

local function relative_to_root(path, root)
  path = normalize(path)
  root = normalize(root)

  if path and root then
    if path == root then
      return "."
    end

    if path:sub(1, #root + 1) == root .. "/" then
      local rel = path:sub(#root + 2)
      if rel ~= "" then
        return rel
      end
    end
  end

  return vim.fn.fnamemodify(path, ":.")
end

local function review_path(root)
  return root .. "/" .. review_file
end

local function default_review_data()
  return {
    version = 1,
    comments = {},
  }
end

local function encode(value)
  return vim.json.encode(value or "")
end

local function write_review_data(path, data)
  data.version = 1
  data.comments = data.comments or {}

  table.sort(data.comments, function(a, b)
    if a.file ~= b.file then
      return tostring(a.file) < tostring(b.file)
    end

    if a.side ~= b.side then
      return tostring(a.side) < tostring(b.side)
    end

    if a.line ~= b.line then
      return tonumber(a.line or 0) < tonumber(b.line or 0)
    end

    return tostring(a.id or "") < tostring(b.id or "")
  end)

  local lines = {
    "{",
    '  "version": 1,',
    '  "comments": [',
  }

  for i, note in ipairs(data.comments) do
    local comma = i < #data.comments and "," or ""

    vim.list_extend(lines, {
      "    {",
      '      "id": ' .. encode(note.id) .. ",",
      '      "file": ' .. encode(note.file) .. ",",
      '      "line": ' .. tostring(tonumber(note.line) or 1) .. ",",
      '      "side": ' .. encode(note.side or "right") .. ",",
      '      "body": ' .. encode(note.body or "") .. ",",
      '      "created_at": ' .. encode(note.created_at) .. ",",
      '      "updated_at": ' .. encode(note.updated_at),
      "    }" .. comma,
    })
  end

  vim.list_extend(lines, {
    "  ]",
    "}",
  })

  vim.fn.writefile(lines, path)
end

local function ensure_review_file(path)
  if vim.fn.filereadable(path) == 1 then
    return
  end

  write_review_data(path, default_review_data())
end

local function read_review_data(root)
  local path = review_path(root)

  if vim.fn.filereadable(path) ~= 1 then
    return default_review_data()
  end

  local raw = table.concat(vim.fn.readfile(path), "\n")
  if raw == "" then
    return default_review_data()
  end

  local ok, data = pcall(vim.json.decode, raw)
  if not ok or type(data) ~= "table" then
    notify("Kann " .. review_file .. " nicht lesen: ungültiges JSON.", vim.log.levels.ERROR)
    return default_review_data()
  end

  if type(data.comments) ~= "table" then
    data.comments = {}
  end

  return data
end

local function read_comments(root)
  return read_review_data(root).comments
end

local function set_highlights()
  api.nvim_set_hl(0, "DiffviewAiReviewMarker", { default = true, link = "DiagnosticInfo" })
  api.nvim_set_hl(0, "DiffviewAiReviewBorder", { default = true, link = "DiagnosticVirtualTextInfo" })
  api.nvim_set_hl(0, "DiffviewAiReviewText", { default = true, link = "Comment" })
end

local function side_for_file(file)
  if file and file.symbol == "a" then
    return "left"
  end

  return "right"
end

local function current_diffview_file(bufnr)
  local ok, lib = pcall(require, "diffview.lib")
  if not ok then
    return nil, nil
  end

  local view = lib.get_current_view()
  if not view or not view.cur_entry or not view.cur_entry.layout then
    return nil, view
  end

  local ok_files, files = pcall(function()
    return view.cur_entry.layout:files()
  end)

  if not ok_files then
    return nil, view
  end

  for _, file in ipairs(files) do
    if file.bufnr == bufnr then
      return file, view
    end
  end

  return nil, view
end

local function current_target()
  local bufnr = api.nvim_get_current_buf()
  local file, view = current_diffview_file(bufnr)

  if file and view then
    if not file.path or file.path == "null" then
      notify("Kein Inline-Kommentar auf leerer Diff-Seite möglich.", vim.log.levels.WARN)
      return nil
    end

    local root = view.adapter and view.adapter.ctx and view.adapter.ctx.toplevel or git_root()

    return {
      root = root,
      file = normalize(file.path),
      line = vim.fn.line("."),
      side = side_for_file(file),
    }
  end

  if view and vim.bo[bufnr].filetype == "DiffviewFiles" then
    notify("Inline-Kommentar im Diff-Fenster setzen, nicht im File-Panel.", vim.log.levels.WARN)
    return nil
  end

  local name = api.nvim_buf_get_name(bufnr)

  if name == "" then
    notify("Kein Dateipfad für aktuellen Buffer.", vim.log.levels.WARN)
    return nil
  end

  local root = git_root()

  return {
    root = root,
    file = relative_to_root(name, root),
    line = vim.fn.line("."),
    side = "right",
  }
end

local function visible_width(bufnr)
  for _, win in ipairs(api.nvim_list_wins()) do
    if api.nvim_win_get_buf(win) == bufnr then
      local textoff = 0
      local info = vim.fn.getwininfo(win)[1]

      if info then
        textoff = info.textoff or 0
      end

      return math.max(40, math.min(100, api.nvim_win_get_width(win) - textoff - 2))
    end
  end

  return 88
end

local function split_lines(text)
  local lines = vim.split(text or "", "\n", { plain = true })

  if #lines == 0 then
    return { "" }
  end

  return lines
end

local function trim_blank_edges(lines)
  while #lines > 0 and lines[1]:match("^%s*$") do
    table.remove(lines, 1)
  end

  while #lines > 0 and lines[#lines]:match("^%s*$") do
    table.remove(lines)
  end

  return lines
end

local function display_slice(text, max_width)
  local result = ""

  for _, char in ipairs(vim.fn.split(text, "\\zs")) do
    if vim.fn.strdisplaywidth(result .. char) > max_width then
      break
    end

    result = result .. char
  end

  return result
end

local function truncate_middle(text, max_width)
  if vim.fn.strdisplaywidth(text) <= max_width then
    return text
  end

  if max_width <= 3 then
    return display_slice(text, max_width)
  end

  local marker = "…"
  local left_width = math.floor((max_width - 1) / 2)
  local right_width = max_width - left_width - 1
  local left = display_slice(text, left_width)
  local right_reversed = display_slice(vim.fn.join(vim.fn.reverse(vim.fn.split(text, "\\zs")), ""), right_width)
  local right = vim.fn.join(vim.fn.reverse(vim.fn.split(right_reversed, "\\zs")), "")

  return left .. marker .. right
end

local function wrap_text(text, width)
  local result = {}

  for _, paragraph in ipairs(split_lines(text)) do
    local line = ""

    if paragraph == "" then
      table.insert(result, " ")
    else
      for word in paragraph:gmatch("%S+") do
        local candidate = line == "" and word or (line .. " " .. word)

        if vim.fn.strdisplaywidth(candidate) > width and line ~= "" then
          table.insert(result, truncate_middle(line, width))
          line = word
        else
          line = candidate
        end
      end

      table.insert(result, truncate_middle(line ~= "" and line or " ", width))
    end
  end

  if #result == 0 then
    table.insert(result, " ")
  end

  return result
end

local function pad_display_width(text, width)
  local value = truncate_middle(text or "", width)
  local padding = math.max(0, width - vim.fn.strdisplaywidth(value))

  return value .. string.rep(" ", padding)
end

local function comment_virt_lines(note, index, width)
  local indent = "  "
  local box_width = math.max(40, width)
  local inside_width = math.max(34, box_width - vim.fn.strdisplaywidth(indent) - 2)
  local content_width = math.max(20, inside_width - 2)
  local target = string.format("%s:%d [%s]", note.file, note.line, note.side or "right")
  local title = string.format("AI review #%d  %s", index, target)
  local title_text = truncate_middle(title, inside_width - 3)
  local title_fill = math.max(0, inside_width - vim.fn.strdisplaywidth("─ " .. title_text .. " "))
  local lines = {
    {
      { indent .. "╭─ ", "DiffviewAiReviewBorder" },
      { title_text, "DiffviewAiReviewBorder" },
      { " " .. string.rep("─", title_fill) .. "╮", "DiffviewAiReviewBorder" },
    },
  }

  for _, part in ipairs(wrap_text(note.body, content_width)) do
    table.insert(lines, {
      { indent .. "│ ", "DiffviewAiReviewBorder" },
      { pad_display_width(part, content_width), "DiffviewAiReviewText" },
      { " │", "DiffviewAiReviewBorder" },
    })
  end

  table.insert(lines, { { indent .. "╰" .. string.rep("─", inside_width) .. "╯", "DiffviewAiReviewBorder" } })

  return lines
end

local function comment_matches(note, file_path, side)
  if normalize(note.file) ~= normalize(file_path) then
    return false
  end

  return (note.side or "right") == side
end

local function same_target(note, target)
  return comment_matches(note, target.file, target.side) and tonumber(note.line) == tonumber(target.line)
end

local function find_comment(comments, target)
  for index, note in ipairs(comments) do
    if same_target(note, target) then
      return note, index
    end
  end
end

local function render_buffer(bufnr, root, file_path, side)
  if not bufnr or not api.nvim_buf_is_valid(bufnr) or not api.nvim_buf_is_loaded(bufnr) then
    return
  end

  api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)

  if not file_path then
    return
  end

  local comments = vim.tbl_filter(function(note)
    return comment_matches(note, file_path, side)
  end, read_comments(root))

  table.sort(comments, function(a, b)
    if a.line == b.line then
      return tostring(a.id or "") < tostring(b.id or "")
    end

    return tonumber(a.line or 0) < tonumber(b.line or 0)
  end)

  local line_count = api.nvim_buf_line_count(bufnr)
  local width = visible_width(bufnr)

  for index, note in ipairs(comments) do
    local lnum = tonumber(note.line)

    if lnum and lnum >= 1 and lnum <= line_count then
      api.nvim_buf_set_extmark(bufnr, ns, lnum - 1, 0, {
        virt_text = { { "  ● AI review", "DiffviewAiReviewMarker" } },
        virt_text_pos = "eol",
        virt_lines = comment_virt_lines(note, index, width),
        virt_lines_above = false,
        sign_text = "●",
        sign_hl_group = "DiffviewAiReviewMarker",
        priority = 200,
      })
    end
  end
end

local function render_current_view()
  set_highlights()

  local file, view = current_diffview_file(api.nvim_get_current_buf())
  if not view or not view.cur_entry or not view.cur_entry.layout then
    if file then
      render_buffer(file.bufnr, git_root(), file.path, side_for_file(file))
    end

    return
  end

  local root = view.adapter and view.adapter.ctx and view.adapter.ctx.toplevel or git_root()
  local ok_files, files = pcall(function()
    return view.cur_entry.layout:files()
  end)

  if not ok_files then
    return
  end

  for _, layout_file in ipairs(files) do
    if layout_file.path and layout_file.path ~= "null" then
      render_buffer(layout_file.bufnr, root, normalize(layout_file.path), side_for_file(layout_file))
    end
  end
end

local function render_current_buffer()
  local bufnr = api.nvim_get_current_buf()
  local file, view = current_diffview_file(bufnr)

  if file and view then
    if file.path and file.path ~= "null" then
      local root = view.adapter and view.adapter.ctx and view.adapter.ctx.toplevel or git_root()
      render_buffer(bufnr, root, normalize(file.path), side_for_file(file))
    end

    return
  end

  local name = api.nvim_buf_get_name(bufnr)
  if name == "" or vim.fn.filereadable(name) ~= 1 then
    return
  end

  local root = git_root()
  render_buffer(bufnr, root, relative_to_root(name, root), "right")
end

local function save_comment(target, body)
  local path = review_path(target.root)
  ensure_review_file(path)

  local data = read_review_data(target.root)
  local comments = data.comments
  local note, index = find_comment(comments, target)
  local now = os.date("!%Y-%m-%dT%H:%M:%SZ")

  if body == "" then
    if index then
      table.remove(comments, index)
      write_review_data(path, data)
      notify("AI review note gelöscht: " .. review_file)
    end

    return
  end

  if note then
    note.body = body
    note.updated_at = now
  else
    table.insert(comments, {
      id = os.date("!%Y%m%dT%H%M%SZ") .. "-" .. tostring(vim.uv.hrtime()),
      file = target.file,
      line = target.line,
      side = target.side,
      body = body,
      created_at = now,
      updated_at = now,
    })
  end

  write_review_data(path, data)
  notify("AI review note gespeichert: " .. review_file)
end

local function editor_size(parent_win, initial_lines)
  local parent_width = api.nvim_win_get_width(parent_win)
  local width = math.max(40, math.min(100, parent_width - 6))
  local height = math.max(3, math.min(8, math.max(#initial_lines, 3)))

  return width, height
end

local function editor_position(parent_win, width, height)
  local cursor = api.nvim_win_get_cursor(parent_win)
  local pos = vim.fn.screenpos(parent_win, cursor[1], math.max(cursor[2] + 1, 1))
  local editor_height = vim.o.lines
  local editor_width = vim.o.columns
  local row = math.max(0, (pos.row or 1))
  local col = math.max(0, (pos.col or 1) - 1)

  if row + height + 2 >= editor_height then
    row = math.max(0, (pos.row or 1) - height - 3)
  end

  if col + width + 2 >= editor_width then
    col = math.max(0, editor_width - width - 3)
  end

  return row, col
end

local function open_comment_editor(target, existing)
  local parent_win = api.nvim_get_current_win()
  local initial_lines = split_lines(existing and existing.body or "")
  local width, height = editor_size(parent_win, initial_lines)
  local row, col = editor_position(parent_win, width, height)

  local buf = api.nvim_create_buf(false, true)
  api.nvim_buf_set_lines(buf, 0, -1, false, initial_lines)
  vim.bo[buf].bufhidden = "wipe"
  vim.bo[buf].buftype = "nofile"
  vim.bo[buf].filetype = "markdown"

  local title = existing and " AI review bearbeiten " or " AI review kommentieren "
  local win = api.nvim_open_win(buf, true, {
    relative = "editor",
    row = row,
    col = col,
    width = width,
    height = height,
    style = "minimal",
    border = "rounded",
    title = title,
    title_pos = "left",
    footer = " Ctrl-s speichern | leer speichern = löschen | q schließen ",
    footer_pos = "right",
    zindex = 60,
  })

  vim.wo[win].wrap = true
  vim.wo[win].linebreak = true

  local closed = false
  local function close()
    if closed then
      return
    end

    closed = true

    if api.nvim_win_is_valid(win) then
      api.nvim_win_close(win, true)
    end
  end

  local function save()
    if closed or not api.nvim_buf_is_valid(buf) then
      return
    end

    local lines = api.nvim_buf_get_lines(buf, 0, -1, false)
    trim_blank_edges(lines)
    local body = table.concat(lines, "\n")

    close()
    save_comment(target, body)
    render_current_view()
    render_current_buffer()
  end

  local map = function(mode, lhs, rhs)
    vim.keymap.set(mode, lhs, rhs, { buffer = buf, silent = true, nowait = true })
  end

  map({ "n", "i" }, "<C-s>", save)
  map("n", "<CR>", save)
  map("n", "q", close)
  map("n", "<Esc>", close)
  map("i", "<C-c>", close)

  vim.cmd("startinsert")
end

function M.add_note()
  local target = current_target()
  if not target then
    return
  end

  local data = read_review_data(target.root)
  local existing = find_comment(data.comments, target)

  open_comment_editor(target, existing)
end

function M.open_notes()
  local root = git_root()
  local path = review_path(root)

  ensure_review_file(path)

  vim.cmd("edit " .. vim.fn.fnameescape(path))
end

function M.render()
  render_current_view()
  render_current_buffer()
end

function M.setup()
  set_highlights()

  local group = api.nvim_create_augroup(augroup_name, { clear = true })

  api.nvim_create_autocmd("User", {
    group = group,
    pattern = {
      "DiffviewDiffBufRead",
      "DiffviewDiffBufWinEnter",
      "DiffviewViewPostLayout",
    },
    callback = function()
      vim.schedule(M.render)
    end,
  })

  api.nvim_create_autocmd("BufWritePost", {
    group = group,
    pattern = "*/.ai-review.json",
    callback = function()
      vim.schedule(M.render)
    end,
  })
end

return M
