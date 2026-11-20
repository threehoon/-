// Only used by browser scenarios running in an isolated Playwright context.
// A reload normally restores the draft; independent scenarios need a fresh workbench.
export async function resetWorkbench(page) {
  await page.locator('.workspace[aria-busy="false"]').waitFor()
  await page.locator('.draft-status[data-state="saving"]').waitFor({ state: 'hidden' })
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('typeset-studio')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Test could not reset isolated draft storage'))
  }))
  await page.reload()
  await page.locator('.workspace[aria-busy="false"]').waitFor()
}
