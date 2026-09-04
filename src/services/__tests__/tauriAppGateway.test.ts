import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

import { TauriAppGateway } from '../tauriAppGateway'

describe('TauriAppGateway', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    listenMock.mockReset()
    listenMock.mockResolvedValue(vi.fn())
  })

  it('maps every timer action to its Rust command', async () => {
    invokeMock.mockResolvedValue({})
    const gateway = new TauriAppGateway()

    await gateway.startTimer({ mode: 'focus', selectedTaskId: null, expectedRevision: 0 })
    await gateway.pauseTimer({ expectedRevision: 1 })
    await gateway.resumeTimer({ expectedRevision: 2 })
    await gateway.resetTimer({ expectedRevision: 3 })
    await gateway.switchTimerMode({ mode: 'short', expectedRevision: 4 })
    await gateway.completeTimer({ activeSessionId: 'session-1', expectedRevision: 5 })

    expect(invokeMock.mock.calls.map(([name]) => name)).toEqual([
      'start_timer',
      'pause_timer',
      'resume_timer',
      'reset_timer',
      'switch_timer_mode',
      'complete_timer',
    ])
    expect(invokeMock).toHaveBeenCalledWith('start_timer', {
      input: { mode: 'focus', selectedTaskId: null, expectedRevision: 0 },
    })
  })

  it('passes explicit statistics day boundaries unchanged', async () => {
    invokeMock.mockResolvedValue([])
    const gateway = new TauriAppGateway()
    const query = {
      from: 0,
      to: 172800000,
      days: [
        { date: '1970-01-01', from: 0, to: 86400000 },
        { date: '1970-01-02', from: 86400000, to: 172800000 },
      ],
    }

    await gateway.getStatistics(query)
    expect(invokeMock).toHaveBeenCalledWith('get_statistics', { query })
  })

  it('maps the data export & backup commands (item 3)', async () => {
    invokeMock
      .mockResolvedValueOnce('backup.json')          // pickExportPath
      .mockResolvedValueOnce({ path: 'backup.json', bytes: 1024, tasks: 3, sessions: 9 })  // exportBackup
      .mockResolvedValueOnce('sess.csv')              // pickExportPath
      .mockResolvedValueOnce({ path: 'sess.csv', bytes: 512, tasks: 0, sessions: 9 })      // exportSessionsCsv
      .mockResolvedValueOnce('import.json')           // pickImportPath
      .mockResolvedValueOnce({ schemaVersion: 1, tasks: 3, sessions: 9 })                  // previewImport
      .mockResolvedValueOnce({ path: 'import.json', tasks: 3, sessions: 9 })               // importBackup

    const gateway = new TauriAppGateway()
    const exportPath = await gateway.pickExportPath('abyssal-reverie-backup.json')
    const backup = await gateway.exportBackup(exportPath!)
    const csvPath = await gateway.pickExportPath('abyssal-reverie-sessions.csv')
    const csv = await gateway.exportSessionsCsv(csvPath!)
    const importPath = await gateway.pickImportPath()
    const preview = await gateway.previewImport(importPath!)
    const imported = await gateway.importBackup(importPath!)

    expect(exportPath).toBe('backup.json')
    expect(backup.bytes).toBe(1024)
    expect(csvPath).toBe('sess.csv')
    expect(csv.sessions).toBe(9)
    expect(importPath).toBe('import.json')
    expect(preview.tasks).toBe(3)
    expect(imported.tasks).toBe(3)

    expect(invokeMock.mock.calls.map(([name]) => name)).toEqual([
      'pick_export_path',
      'export_backup_to',
      'pick_export_path',
      'export_sessions_csv_to',
      'pick_import_path',
      'preview_import_from',
      'import_backup_from',
    ])
    expect(invokeMock).toHaveBeenCalledWith('export_backup_to', { path: 'backup.json' })
    expect(invokeMock).toHaveBeenCalledWith('import_backup_from', { path: 'import.json' })
  })

  it('subscribes to the global-shortcut conflict event', () => {
    const gateway = new TauriAppGateway()
    const handler = vi.fn()
    gateway.subscribeGlobalShortcutConflict(handler)

    expect(listenMock).toHaveBeenCalledWith('global-shortcut-conflict', expect.any(Function))

    // Simulate the Rust event and confirm the payload reaches the callback.
    const [, listener] = listenMock.mock.calls[0]
    listener({ payload: { shortcut: 'CommandOrControl+Alt+Space' } })
    expect(handler).toHaveBeenCalledWith('CommandOrControl+Alt+Space')
  })

  it('maps the tag commands (v1.1)', async () => {
    invokeMock.mockResolvedValue({})
    const gateway = new TauriAppGateway()

    await gateway.listTags()
    await gateway.createTag({ name: '运动' })
    await gateway.updateTag({ id: 'tag-1', name: ' renamed ' })
    await gateway.reorderTag({ id: 'tag-1', direction: -1 })
    await gateway.previewDeleteTag('tag-1')
    await gateway.deleteTag('tag-1')

    expect(invokeMock.mock.calls.map(([name]) => name)).toEqual([
      'list_tags',
      'create_tag',
      'update_tag',
      'reorder_tag',
      'preview_delete_tag',
      'delete_tag',
    ])
    expect(invokeMock).toHaveBeenCalledWith('create_tag', { input: { name: '运动' } })
    expect(invokeMock).toHaveBeenCalledWith('reorder_tag', { input: { id: 'tag-1', direction: -1 } })
    expect(invokeMock).toHaveBeenCalledWith('delete_tag', { id: 'tag-1' })
  })
})
