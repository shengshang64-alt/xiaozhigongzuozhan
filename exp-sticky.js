async page => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("http://localhost:8000/", { waitUntil: "domcontentloaded" })
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForTimeout(6000)
  const r = await page.evaluate(() => {
    const wrapper = document.querySelector('[role="tablist"]')?.parentElement
    // 实验1：把 wrapper 的 position 改成 static 看 docW 变化
    const before = document.documentElement.scrollWidth
    const tl = document.querySelector('[role="tablist"]')
    const origPos = tl.style.position
    tl.style.position = 'static'
    const afterStatic = document.documentElement.scrollWidth
    tl.style.position = origPos

    // 实验2：给 body 加 overflow-x hidden
    document.body.style.overflowX = 'hidden'
    const afterBodyHidden = document.documentElement.scrollWidth
    document.body.style.overflowX = ''

    return { before, afterStatic, afterBodyHidden }
  })
  return JSON.stringify(r)
}
