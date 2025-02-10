// import { Cell } from "../models.js"
// import { GPTResponse, MessageType } from "../models.js"
interface GPTResponse {
    examplesText: string | null,
    solution: string,
    pythonCode: string,
}
enum MessageType {
    GET_CELLS = "getCells",
    GET_PROMPT = "getPrompt",
    GPT_RESPONSE = "gptResponse",
    GET_RLHF_PROMPT = "getRLHFPrompt",
    GET_TASK_INFO = "getTaskInfo",
    PASTE_RLHF_ANSWERS = "pasteRLHFAnswers",
    READ_MODEL_ANSWERS = "readModelAnswers"
}
// Importing from models.js is breaking the compiled code.


class ElementHandler {
    private id: string
    constructor() {
        this.id = "custom-ext-added"
    }

    private copyToClipboard(text: string, button: HTMLButtonElement | null) {
        navigator.clipboard.writeText(text);
        (button?.nextElementSibling as HTMLElement | null)?.focus();
        button?.remove();
    }

    createButton(data: string, options: { onClick?: EventListenerOrEventListenerObject, onClickCopy?: string }): HTMLButtonElement {
        const button = document.createElement("button")
        button.classList.add(this.id)
        button.textContent = data
        if (options.onClick != undefined) {
            button.addEventListener("click", options.onClick)
        }
        if (options.onClickCopy != undefined) {
            button.addEventListener("click", () => this.copyToClipboard(options.onClickCopy!, button))
        }
        return button
    }

    createP(data: string, options?: { model: string, key: string }): HTMLParagraphElement {
        const p = document.createElement("p")
        p.classList.add(this.id)
        p.textContent = data
        if (options != undefined) {
            p.setAttribute("data-model", options.model)
            p.setAttribute("data-key", options.key)
        }
        return p
    }

    clearAll(element: Element | null = null): void {
        const elements = (element ?? document).getElementsByClassName(this.id)
        while (elements.length > 0) {
            elements[0].remove()
        }
    }
}

const elementHandler = new ElementHandler()

function readCells(): any[] {
    const htmlCells = Array.from(document.getElementsByClassName('notebook-cell-list'))[0].children
    const cells: any[] = []

    for (let cell of htmlCells) {
        const cellClasses = cell.classList
        if (cellClasses.contains('code')) {
            let codeCells = cell.getElementsByClassName('editor-scrollable')
            let codeCell: HTMLElement
            if (codeCells.length > 0) {
                codeCell = codeCells[0] as HTMLElement
            } else {
                codeCell = cell.getElementsByClassName('editor')[0] as HTMLElement
                if (codeCell.getElementsByClassName('monaco-colorized').length > 0) {
                    codeCell = codeCell.getElementsByClassName('monaco-colorized')[0] as HTMLElement
                } else if (codeCell.getElementsByClassName('editor-scrollable').length > 0) {
                    codeCell = codeCell.getElementsByClassName('editor-scrollable')[0] as HTMLElement
                }
            }
            cells.push({
                cell_type: 'code',
                content: codeCell.innerText.replaceAll(' ', ' ')
            })
        } else if (cellClasses.contains('text')) {
            const block = {
                cell_type: 'text',
                content: (cell as HTMLElement).innerText.replaceAll(' ', ' '),
                prompt: null as string | null
            }
            if (block.content.startsWith("Metadata")) {
                const markdown = (cell as HTMLElement).getElementsByClassName('markdown')[0]
                const p = markdown.getElementsByTagName('p')
                const codes = markdown.getElementsByTagName('pre')
                const code = codes[codes.length - 2]
                let prompt = p[0].innerText.replaceAll('Prompt: - ', '')
                prompt += `\n\n${p[1].innerText}`
                prompt += `\n\n${p[p.length - 1].innerText}`
                prompt += "\n```python\n" + code.innerText.trim() + "\n```"
                block.prompt = prompt
            }
            cells.push(block)
        }
    }

    return cells
}

/**
 * Read and concatenate the RLHF prompt from the metadata
 * @returns The RLHF prompt to generate the conversation turns
 */
function readRLHFPrompt(): string {
    const metadata = Array.from(document.getElementsByClassName('ant-space')[0].children).map((e) => e as HTMLDivElement)
    const subtopic = metadata[5].innerText
    const useCase = metadata[6].innerText
    const userProfile = metadata[10].innerText
    const taskCategoryList = `T${metadata[metadata.length - 1].innerText.replace('\n', '').replaceAll('\n', ', ').replaceAll('_', ' ').substring(1)}`
    return `${useCase}\n${userProfile}\n${subtopic}\n${taskCategoryList}`
}

/**
 * Read the prompt and the answers from both models
 * @param turn - The turn number to read the answers from
 * @returns The prompt and the answers from both models
 */
function getModelAnswers(turn: number | null = null): Record<'prompt' | 'model_a' | 'model_b', string> {
    function getText(copyBtn: Element): string {
        return copyBtn.parentElement?.parentElement?.getAttribute("text")!
    }
    const turnContainers = Array.from(document.getElementsByClassName('ant-collapse-borderless')[0].children)
    const turnContainer = turnContainers[(turn ?? turnContainers.length) - 1]
    const copyBtns = turnContainer!.querySelectorAll('.anticon-copy:not(.markdown-body .anticon-copy)');
    return {
        "prompt": getText(copyBtns[0]),
        "model_a": getText(copyBtns[1]),
        "model_b": getText(copyBtns[2])
    }
}

/**
 * Get the task ID from the back button
 * @returns The task ID
 */
function getTaskId(): string {
    const elements = Array.from(document.getElementsByTagName("a"))
    const url: string = elements.filter((a) => a.getAttribute("href")?.includes("conversations")).map((a) => a.getAttribute("href")!)[0]
    const taskId = url.match(/conversations\/(\d+)\//)![1]
    return taskId
}

/**
 * Get the number of turns in the conversation
 * @returns The number of turns
 */
function getTurnsCount(): number {
    return document.getElementsByClassName('ant-collapse-borderless')[0].children.length
}

/**
 * Fill the answers in the DOM
 * @param answers - The answers to fill
 * @param turn - The turn number to fill the answers from
 * @returns The message to display in the alert
 */
async function fillAnswers(answers: Record<string, any>, turn: number | null = null, folderLinks: { model_a: string, model_b: string } | undefined): Promise<string> {
    let collapseContents = Array.from(document.getElementsByClassName("ant-collapse-content")) // Model A, Model B, Compare
    collapseContents = collapseContents.filter((elem, _) => elem.getElementsByClassName("ant-collapse-content").length == 0 && elem.getElementsByTagName("textarea").length > 0);
    turn = turn ?? (collapseContents.length / 3)
    const modelAnswers = getModelAnswers(turn)
    const allDropdowns = []
    for (let i = (turn - 1) * 3; i < turn * 3; i++) {
        let model = collapseContents[i]
        elementHandler.clearAll(model)
        let dropdowns = model.getElementsByTagName("input")
        allDropdowns.push(...dropdowns)
        let textAreas = model.getElementsByTagName("textarea")
        for (let j = 0; j < dropdowns.length; j++) {
            const modelKey = Object.keys(answers)[i % 3]
            const key = Object.keys(answers[modelKey])[j]
            const body = modelKey === "comparison" ? answers[modelKey] : answers[modelKey][key]
            if (dropdowns[j].parentElement?.parentElement?.textContent?.toLowerCase() != body.score?.toLowerCase()) {
                dropdowns[j].parentElement?.parentElement?.appendChild(elementHandler.createP(body?.score, { model: modelKey, key: key }))
            }
            const copyToClipboardBtn = elementHandler.createButton(`Paste answer (${body.comment.split(" ").length} w)`, { onClickCopy: body.comment })
            if (textAreas[j].innerHTML != body.comment) {
                textAreas[j].parentElement?.insertBefore(copyToClipboardBtn, textAreas[j])
                const click = () => {
                    copyToClipboardBtn.click()
                    textAreas[j].removeEventListener("click", click)
                }
                textAreas[j].addEventListener("click", click)
            }
        }

        const modelKey = i % 3 === 0 ? "model_a" : i % 3 === 1 ? "model_b" : undefined
        if (modelKey !== undefined) {
            const btnText = ["python", "javascript", "typescript", "cpp"].some(language => modelAnswers[modelKey].includes(`\`\`\`${language}`)) ? "Refer to sandbox" : "No code"
            const btn = elementHandler.createButton(btnText, { onClickCopy: btnText })

            if (textAreas[5].value != btnText) {
                textAreas[5].parentElement?.insertBefore(btn, textAreas[5])
                const click = () => {
                    btn.click()
                    textAreas[5].removeEventListener("click", click)
                }
                textAreas[5].addEventListener("click", click)
            }

            // Copy links from previous turns
            let prevModel = i > 2 ? collapseContents[i - 3] : undefined
            let prevTextAreas = prevModel?.getElementsByTagName("textarea")

            // Code environment
            let link = prevTextAreas?.[5]?.value
            let text = link
            if (link?.startsWith("https://") || link == undefined) {
                if (link?.includes("stackblitz") || link == undefined) {
                    const taskId = getTaskId()
                    link = `https://stackblitz.com/edit/rlhf?file=${taskId}%2F${turn}${modelKey.slice(5)}%2Fcode.js`
                    text = "Stackblitz"
                }
                if (text != undefined) {
                    const copyLinkBtn = elementHandler.createButton(text, { onClickCopy: link })
                    textAreas[5].parentElement?.insertBefore(copyLinkBtn, textAreas[5])
                    const click = () => {
                        copyLinkBtn.click()
                        textAreas[5].removeEventListener("click", click)
                    }
                    textAreas[5].addEventListener("click", click)
                }
            }
            // Code screenshots folder
            link = prevTextAreas?.[6]?.value ?? folderLinks?.[modelKey]
            if (link != undefined && !link.startsWith("https://")) {
                prevModel = collapseContents[i - 6]
                prevTextAreas = prevModel?.getElementsByTagName("textarea")
                if (prevTextAreas != undefined) {
                    link = prevTextAreas[6].value
                }
            }
            if (link?.startsWith("https://") && textAreas[6].value != link) {
                const copyLinkBtn = elementHandler.createButton("Copy link", { onClickCopy: link })
                textAreas[6].parentElement?.insertBefore(copyLinkBtn, textAreas[6])
                const click = () => {
                    copyLinkBtn.click()
                    textAreas[6].removeEventListener("click", click)
                }
                textAreas[6].addEventListener("click", click)
            }
        }
    }

    // Hide focusable elements while manually activating the DOM content
    const elementsToHide: HTMLElement[] = Array.from(document.querySelectorAll('input, button, textarea, pre'))
    elementsToHide.forEach(element => {
        if (!(element.parentElement?.parentElement?.lastChild as HTMLElement)?.classList?.contains('custom-ext-added')) {
            element.style.display = 'none'
        }
    })
    let finished = false
    alert("In this step, try to open all the dropdowns.")
    await new Promise(resolve => setTimeout(resolve, 10000))
    while (!finished) {
        await new Promise(resolve => setTimeout(resolve, 10000))
        finished = confirm("Continue?\n\nIf you are done, click 'Ok'.\nIf you need more time, click 'Cancel'.")
    }
    elementsToHide.forEach(element => { element.style.display = '' })

    // Click the dropdowns
    for (let j = 0; j < allDropdowns.length; j++) {
        const dropdown = allDropdowns[j]
        const controlId = dropdown.getAttribute("aria-controls")
        if (controlId != null) {
            const control = document.getElementById(controlId)
            const options = control?.parentElement?.lastChild?.firstChild?.firstChild?.firstChild?.childNodes;
            const relatedP: HTMLElement = dropdown.parentElement?.parentElement?.lastChild as HTMLElement
            const modelKey = relatedP.getAttribute("data-model")
            const key = relatedP.getAttribute("data-key")
            if (modelKey != undefined && key != undefined) {
                const body = modelKey === "comparison" ? answers[modelKey] : answers[modelKey][key]
                options?.forEach((option) => {
                    const score = body?.score?.toLowerCase()
                    const optionText = option.textContent?.toLowerCase()
                    if (optionText == score || score?.includes(optionText)) {
                        (option as HTMLElement).click()
                    }
                })
            }
        }
    }

    const container = document.getElementsByClassName("turn-container")[turn - 1]
    const chooseButtons = Array.from(container.getElementsByTagName("button")).filter((e) => e.textContent?.includes("Choose") &&
        e.parentElement?.parentElement?.childElementCount == 6)
    const buttonsTagged = chooseButtons.map((e) => {
        const key = e.parentElement?.parentElement?.children[2].textContent?.split(" ")[1]
        return { button: e, key }
    })
    const score: string = answers["comparison"]["score"]
    const button = buttonsTagged.find((e) => e.key == score.substring(6, 7))
    if (button != undefined) {
        button.button.click()
    }
    return score
}

chrome.runtime.onMessage.addListener(
    async function (message: { source: MessageType, response?: GPTResponse, answers?: Record<string, any>, turn?: number, folderLinks?: { model_a: string, model_b: string } }, _, sendResponse) {
        if (message.source === MessageType.GET_CELLS || message.source === MessageType.GET_PROMPT) {
            sendResponse(readCells())
        } else if (message.source === MessageType.GET_RLHF_PROMPT) {
            sendResponse(readRLHFPrompt())
        } else if (message.source === MessageType.READ_MODEL_ANSWERS) {
            sendResponse(getModelAnswers(message.turn))
        } else if (message.source === MessageType.GET_TASK_INFO) {
            const turnsCount = getTurnsCount()
            const taskId = getTaskId()
            sendResponse({ turnsCount, taskId })
        } else if (message.source === MessageType.PASTE_RLHF_ANSWERS) {
            const response = await fillAnswers(message.answers!, message.turn, message.folderLinks)
            alert(response)
            sendResponse(response)
        }
    }
)
