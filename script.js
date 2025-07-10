// =========================================================
// 全局变量和DOM元素引用
// =========================================================
let allRecipes = {};
let allDocuments = {}; // 新增：用于存储非菜谱的Markdown文档
let categoryHierarchy = {};

const REPO_OWNER = 'Anduin2017';
const REPO_NAME = 'HowToCook';
const GITHUB_TREES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/master?recursive=1`;
const GITHUB_TOKEN = ''; // 如果需要，在这里填写你的GitHub Personal Access Token

// DOM元素引用
const categoryBtn = document.getElementById('category-btn');
const categoryDropdown = document.getElementById('category-dropdown');
const randomBtn = document.getElementById('random-btn');
const showAllBtn = document.getElementById('show-all-btn');
const recipesContainer = document.getElementById('recipes-container');

// 分类名映射表 (优化：保持与目录结构一致，仅用于显示名称转换)
const CATEGORY_MAP = {
    'aquatic': '水产', 'breakfast': '早餐', 'condiment': '调味品',
    'dessert': '甜点', 'drink': '饮品', 'meat_dish': '肉类菜',
    'soup': '汤与粥', 'staple': '主食', 'vegetable_dish': '素菜',
    'semi-finished': '半成品加工', 'cold-dish': '凉菜', 'hard-dishes': '硬菜',
    'pickled-foods': '腌制', 'starsystem': '星级难度', 'tips': '小贴士',
    'dishes': '菜品总览', 'advanced': '进阶', 'learn': '学习'
};

// 系统文件或不相关的文件名
const SYSTEM_OR_IRRELEVANT_NAMES = new Set(['README.md', '.DS_Store', '.git', '.github', 'img', 'assets']);


// =========================================================
// 初始化函数
// =========================================================
async function initializeRecipes() {
    recipesContainer.innerHTML = '<div class="loading">正在加载菜谱，请稍候...</div>';
    try {
        await fetchAndProcessDataFromAPI();
        populateCategoryDropdown();
        displayContentByCategory(); // 默认显示全部菜谱
    } catch (error) {
        console.error('初始化失败:', error);
        recipesContainer.innerHTML = `<div class="error">加载菜谱失败：${error.message || error}</div>`;
    }
}


// =========================================================
// 数据抓取和处理
// =========================================================
async function fetchAndProcessDataFromAPI() {
    const headers = GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {};
    const response = await fetch(GITHUB_TREES_API_URL, { headers });

    if (!response.ok) {
        throw new Error(`GitHub API 请求失败 (状态: ${response.status})`);
    }

    const { tree } = await response.json();

    const recipeFilesToFetch = []; // 用于常规菜谱文件
    const docFilesToFetch = []; // 用于非菜谱的文档文件，例如 tips 下的
    const starCategoryFiles = []; // 用于存放 XStar.md 文件

    tree.forEach(item => {
        const pathParts = item.path.split('/');
        const itemName = pathParts[pathParts.length - 1];

        if (SYSTEM_OR_IRRELEVANT_NAMES.has(itemName) || (pathParts.length === 1 && item.type === 'blob')) {
            return;
        }

        let currentLevel = categoryHierarchy;
        for (let i = 0; i < pathParts.length - 1; i++) {
            const part = pathParts[i];
            if (!currentLevel[part]) {
                currentLevel[part] = {};
            }
            currentLevel = currentLevel[part];
        }

        if (item.type === 'blob' && itemName.endsWith('.md') && itemName.toLowerCase() !== 'readme.md') {
            const categoryPath = pathParts.slice(0, -1);
            // 确保 categoryPath 不为空
            const rawCategoryName = categoryPath.length > 0 ? categoryPath[categoryPath.length - 1] : '';
            const displayCategory = CATEGORY_MAP[rawCategoryName] || rawCategoryName;

            const rawFileUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/${item.path}`;

            // 特殊处理 XStar.md 文件 (例如 1Star.md, 2Star.md)
            if (itemName.match(/^\d+Star\.md$/i) && categoryPath.includes('starsystem')) {
                const starLevelMatch = itemName.match(/^(\d+)Star\.md$/i);
                if (starLevelMatch) {
                    const starLevel = `${starLevelMatch[1]}星难度`;
                    starCategoryFiles.push({ url: rawFileUrl, starCategory: starLevel });
                }
            }
            // 判断是否是 tips, advanced, learn 目录下的文档
            else if (categoryPath.includes('tips') || categoryPath.includes('advanced') || categoryPath.includes('learn')) {
                docFilesToFetch.push({ url: rawFileUrl, category: displayCategory, name: itemName.replace(/\.md$/, '') });
            }
            else {
                recipeFilesToFetch.push({ url: rawFileUrl, category: displayCategory });
            }
        }
    });

    // ----------------------------------------------------
    // 第一步：获取并解析所有常规菜谱文件
    // ----------------------------------------------------
    const fetchedRegularFiles = await Promise.all(
        recipeFilesToFetch.map(file =>
            fetch(file.url)
                .then(res => res.ok ? res.text() : Promise.reject(`下载 ${file.url} 失败`))
                .then(text => ({ content: text, category: file.category, url: file.url }))
                .catch(err => {
                    console.warn(`常规菜谱文件下载失败: ${file.url} - ${err}`);
                    return null;
                })
        )
    );

    // 将常规菜谱添加到 allRecipes
    fetchedRegularFiles.forEach(file => {
        if (file) {
            const recipe = parseMarkdownToRecipe(file.content, file.category);
            if (recipe && recipe.name) { // 确保菜谱有名称
                if (!allRecipes[recipe.category]) {
                    allRecipes[recipe.category] = [];
                }
                allRecipes[recipe.category].push(recipe);
            }
        }
    });

    // ----------------------------------------------------
    // 第二步：获取并解析 XStar.md 文件，提取其中的菜谱链接
    // ----------------------------------------------------
    const recipeUrlsFromStars = [];
    await Promise.all(
        starCategoryFiles.map(file =>
            fetch(file.url)
                .then(res => res.ok ? res.text() : Promise.reject(`下载星级文件 ${file.url} 失败`))
                .then(text => {
                    const lines = text.split('\n');
                    lines.forEach(line => {
                        const match = line.match(/\[.*?\]\((.*?\.md)\)/);
                        if (match && match[1]) {
                            let relativePath = match[1];
                            const currentFilePath = new URL(file.url);
                            const resolvedUrl = new URL(relativePath, currentFilePath);
                            // 确保路径正确，去除可能的 /master/ 后缀
                            const finalPath = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master` + resolvedUrl.pathname.replace(/^\/(\w+)\/(\w+)\/master/, '');
                            const cleanFinalPath = finalPath.replace(/\/\.\.\//g, '/').replace(/\/.\//g, '/');

                            recipeUrlsFromStars.push({ url: cleanFinalPath, starCategory: file.starCategory });
                        }
                    });
                })
                .catch(err => {
                    console.warn(`星级索引文件下载或解析失败: ${file.url} - ${err}`);
                    return null;
                })
        )
    );

    // 过滤掉已经获取过的常规菜谱，避免重复抓取
    const existingRecipeUrls = new Set(fetchedRegularFiles.filter(f => f).map(f => f.url));
    const uniqueStarRecipesToFetch = recipeUrlsFromStars.filter(file => !existingRecipeUrls.has(file.url));

    // ----------------------------------------------------
    // 第三步：获取并解析 XStar.md 中引用的菜谱文件
    // ----------------------------------------------------
    const fetchedStarRecipes = await Promise.all(
        uniqueStarRecipesToFetch.map(file =>
            fetch(file.url)
                .then(res => res.ok ? res.text() : Promise.reject(`下载星级关联菜谱 ${file.url} 失败`))
                .then(text => ({ content: text, starCategory: file.starCategory }))
                .catch(err => {
                    console.warn(`星级关联菜谱文件下载失败: ${file.url} - ${err}`);
                    return null;
                })
        )
    );

    // 将星级菜谱添加到 allRecipes
    fetchedStarRecipes.forEach(file => {
        if (file) {
            const recipe = parseMarkdownToRecipe(file.content, file.starCategory);
            if (recipe && recipe.name) {
                if (!allRecipes[recipe.category]) {
                    allRecipes[recipe.category] = [];
                }
                allRecipes[recipe.category].push(recipe);
            }
        }
    });

    // ----------------------------------------------------
    // 第四步：获取并存储所有非菜谱的文档文件 (例如 tips, advanced, learn)
    // ----------------------------------------------------
    const fetchedDocFiles = await Promise.all(
        docFilesToFetch.map(file =>
            fetch(file.url)
                .then(res => res.ok ? res.text() : Promise.reject(`下载文档文件 ${file.url} 失败`))
                .then(text => ({ content: text, category: file.category, name: file.name }))
                .catch(err => {
                    console.warn(`文档文件下载失败: ${file.url} - ${err}`);
                    return null;
                })
        )
    );

    fetchedDocFiles.forEach(file => {
        if (file) {
            if (!allDocuments[file.category]) {
                allDocuments[file.category] = [];
            }
            allDocuments[file.category].push({ name: file.name, content: file.content });
        }
    });
}


// =========================================================
// Markdown 解析和显示
// =========================================================
function parseMarkdownToRecipe(markdown, category) {
    const lines = markdown.split('\n');
    let name = '';
    let description = '';
    let difficulty = '';
    let content = '';

    // 提取菜谱名称 (第一个 H1 标题)
    const nameMatch = markdown.match(/^#\s*(.+)/m);
    if (nameMatch) {
        name = nameMatch[1].trim();
    } else {
        // 如果没有 H1 标题，则不认为是有效菜谱
        return null;
    }

    // 提取描述 (在 H1 标题之后，第一个 H2 标题之前)
    const descriptionMatch = markdown.match(/^#\s*.+\n\n([^\n]+)/m);
    if (descriptionMatch) {
        description = descriptionMatch[1].trim();
    }

    // 提取难度
    const difficultyMatch = markdown.match(/预估烹饪难度：(.*?)$/m);
    if (difficultyMatch) {
        difficulty = difficultyMatch[1].trim();
    }

    // 从第一个 H2 标题开始作为内容
    const contentStartIndex = markdown.indexOf('## 必备原料和工具'); // 或者其他你定义的第一个内容标题
    if (contentStartIndex !== -1) {
        content = markdown.substring(contentStartIndex);
    } else {
        content = markdown; // 如果没有 H2 标题，则取全部
    }

    // 使用 marked.js 将 Markdown 转换为 HTML
    const htmlContent = marked.parse(content);

    return { name, description, difficulty, content: htmlContent, category };
}


// =========================================================
// 分类下拉菜单生成
// =========================================================
function populateCategoryDropdown() {
    categoryDropdown.innerHTML = '';

    const allOption = document.createElement('a');
    allOption.textContent = '全部菜谱';
    allOption.dataset.value = 'all';
    allOption.classList.add('category-item');
    categoryDropdown.appendChild(allOption);

    // 定义顶层分类的显示顺序和其类型
    // 注意：这里的 key 应该对应 GitHub 仓库中的目录名
    const topLevelCategoriesConfig = [
        { key: 'dishes', displayName: '菜品总览', type: 'recipes' },
        { key: 'starsystem', displayName: '星级难度', type: 'recipes' },
        { key: 'tips', displayName: '小贴士', type: 'documents' },
        { key: 'advanced', displayName: '进阶', type: 'documents' },
        { key: 'learn', displayName: '学习', type: 'documents' }
    ];

    topLevelCategoriesConfig.forEach(topCatConfig => {
        const topKey = topCatConfig.key;
        const topDisplayName = topCatConfig.displayName; // 直接使用配置中的 displayName

        // 检查这个顶级分类是否有任何内容 (菜谱或文档)
        // 或者它在 categoryHierarchy 中有子分类
        const hasSubCategoriesInHierarchy = Object.keys(categoryHierarchy[topKey] || {}).length > 0;
        const hasDirectRecipes = allRecipes[topDisplayName] && allRecipes[topDisplayName].length > 0;
        const hasDirectDocuments = allDocuments[topDisplayName] && allDocuments[topDisplayName].length > 0;

        // 只有当这个顶级分类确实有内容或子分类时才显示其头部
        if (hasSubCategoriesInHierarchy || hasDirectRecipes || hasDirectDocuments) {
            const header = document.createElement('div');
            header.className = 'category-header';
            header.textContent = topDisplayName;
            categoryDropdown.appendChild(header);

            // 处理子分类 (针对菜谱类型，如 'dishes', 'starsystem' 的子目录)
            if (topCatConfig.type === 'recipes' && hasSubCategoriesInHierarchy) {
                const subKeys = Object.keys(categoryHierarchy[topKey]).sort((a,b) => {
                    if (topKey === 'starsystem') {
                        const numA = parseInt(a.match(/\d+/)?.[0] || '0');
                        const numB = parseInt(b.match(/\d+/)?.[0] || '0');
                        return numA - numB;
                    }
                    return a.localeCompare(b, 'zh-CN');
                });

                subKeys.forEach(subKey => {
                    const subDisplayName = CATEGORY_MAP[subKey] || subKey;
                    // 仅当这个子分类下有实际菜谱时才添加
                    if (allRecipes[subDisplayName] && allRecipes[subDisplayName].length > 0) {
                        const subOption = document.createElement('a');
                        subOption.className = 'subcategory-item';
                        subOption.textContent = subDisplayName;
                        subOption.dataset.value = subDisplayName;
                        subOption.dataset.type = 'recipes'; // 明确为菜谱类型
                        categoryDropdown.appendChild(subOption);
                    }
                });
            }

            // 直接列出该顶级分类下的文档文件 (例如 '小贴士'，'进阶', '学习')
            if (topCatConfig.type === 'documents' && allDocuments[topDisplayName]) {
                allDocuments[topDisplayName].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).forEach(doc => {
                    const docOption = document.createElement('a');
                    docOption.className = 'subcategory-item document-item';
                    docOption.textContent = doc.name;
                    docOption.dataset.value = doc.name; // 文档名称作为值
                    docOption.dataset.category = topDisplayName; // 文档所属的顶级分类名称
                    docOption.dataset.type = 'document';
                    categoryDropdown.appendChild(docOption);
                });
            }
        }
    });
}


// =========================================================
// 内容显示函数 (取代 displayAllRecipes)
// =========================================================
let currentCategory = 'all'; // 默认当前分类

function displayContentByCategory(category = currentCategory, type = 'recipes', contentName = null) {
    recipesContainer.innerHTML = ''; // 清空容器

    if (type === 'document' && contentName) {
        // 显示单个文档内容
        const docCategory = category; // 此时 category 是文档所属的分类名
        const doc = allDocuments[docCategory]?.find(d => d.name === contentName);
        if (doc) {
            const docEl = document.createElement('div');
            docEl.className = 'document-content';
            docEl.innerHTML = `<h2>${doc.name}</h2>${marked.parse(doc.content)}`;
            recipesContainer.appendChild(docEl);
        } else {
            recipesContainer.innerHTML = `<div class="recipe"><p>未找到文档: ${contentName}</p></div>`;
        }
        return; // 显示文档后直接返回
    }

    // 以下是显示菜谱的逻辑
    let recipesToDisplay = [];

    if (category === 'all') {
        Object.values(allRecipes).forEach(arr => recipesToDisplay.push(...arr));
    } else if (category === '星级难度') { // 特殊处理星级难度，因为它是一个虚拟分类
        Object.keys(allRecipes).forEach(categoryName => {
            if (categoryName.includes('星难度')) {
                recipesToDisplay.push(...allRecipes[categoryName]);
            }
        });
    }
    else if (allRecipes[category]) {
        recipesToDisplay = allRecipes[category];
    } else {
        // 处理父级分类，例如 dishes (菜品总览)
        const parentKey = Object.keys(CATEGORY_MAP).find(key => CATEGORY_MAP[key] === category);
        if (parentKey && categoryHierarchy[parentKey]) {
            // 遍历所有子分类并添加菜谱
            Object.keys(categoryHierarchy[parentKey]).forEach(subKey => {
                const subDisplayName = CATEGORY_MAP[subKey] || subKey;
                if (allRecipes[subDisplayName]) {
                    recipesToDisplay.push(...allRecipes[subDisplayName]);
                }
            });
        }
    }

    if (recipesToDisplay.length > 0) {
        // 去重并排序显示菜谱
        const uniqueRecipes = Array.from(new Map(recipesToDisplay.map(r => [r.name, r])).values());
        uniqueRecipes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        uniqueRecipes.forEach(recipe => displayRecipe(recipe, false));
    } else {
        recipesContainer.innerHTML = '<div class="recipe"><p>该分类下暂无菜谱。</p></div>';
    }
}


// =========================================================
// 单个菜谱显示函数
// =========================================================
function displayRecipe(recipe, isRandom = false) {
    const recipeEl = document.createElement('div');
    recipeEl.className = 'recipe';
    if (isRandom) {
        recipeEl.classList.add('random-recipe');
    }

    const titleEl = document.createElement('h2');
    titleEl.innerHTML = `${recipe.name} <span class="toggle-icon">▼</span>`;
    titleEl.classList.add('recipe-title');

    const tagsEl = document.createElement('div');
    tagsEl.className = 'recipe-tags';
    if (recipe.category) {
        const categoryTag = document.createElement('span');
        categoryTag.className = 'tag category-tag';
        categoryTag.textContent = recipe.category;
        tagsEl.appendChild(categoryTag);
    }
    if (recipe.difficulty) {
        const difficultyTag = document.createElement('span');
        difficultyTag.className = 'tag difficulty-tag';
        difficultyTag.textContent = recipe.difficulty;
        tagsEl.appendChild(difficultyTag);
    }

    const detailsEl = document.createElement('div');
    detailsEl.className = 'recipe-details';
    detailsEl.innerHTML = `<p>${recipe.description}</p>${recipe.content}`;

    const iconEl = titleEl.querySelector('.toggle-icon');
    if (isRandom) {
        detailsEl.classList.add('visible');
        iconEl.classList.add('expanded');
    }

    recipeEl.appendChild(titleEl);
    recipeEl.appendChild(tagsEl);
    recipeEl.appendChild(detailsEl);
    recipesContainer.appendChild(recipeEl);

    titleEl.addEventListener('click', () => {
        detailsEl.classList.toggle('visible');
        iconEl.classList.toggle('expanded');
    });
}


// =========================================================
// 随机推荐功能
// =========================================================
function randomRecommend() {
    let recipesToChooseFrom = [];
    if (currentCategory === 'all') {
        Object.values(allRecipes).forEach(arr => recipesToChooseFrom.push(...arr));
    } else if (currentCategory.includes('星难度')) { // 针对星级难度分类
        recipesToChooseFrom = allRecipes[currentCategory] || [];
    }
    else if (allRecipes[currentCategory]) {
        recipesToChooseFrom = allRecipes[currentCategory];
    } else {
        // 如果是父级分类，也包含其下所有菜谱
        const parentKey = Object.keys(CATEGORY_MAP).find(key => CATEGORY_MAP[key] === currentCategory);
        if (parentKey && categoryHierarchy[parentKey]) {
            Object.keys(categoryHierarchy[parentKey]).forEach(subKey => {
                const subDisplayName = CATEGORY_MAP[subKey] || subKey;
                if (allRecipes[subDisplayName]) {
                    recipesToChooseFrom.push(...allRecipes[subDisplayName]);
                }
            });
        }
    }

    if (recipesToChooseFrom.length > 0) {
        // 去重
        const uniqueRecipes = Array.from(new Map(recipesToChooseFrom.map(r => [r.name, r])).values());
        const randomIndex = Math.floor(Math.random() * uniqueRecipes.length);
        const randomRecipe = uniqueRecipes[randomIndex];
        recipesContainer.innerHTML = ''; // 清空之前的内容
        displayRecipe(randomRecipe, true);
    } else {
        recipesContainer.innerHTML = '<div class="recipe"><p>当前分类下没有可推荐的菜谱。</p></div>';
    }
}


// =========================================================
// 事件监听器
// =========================================================
randomBtn.addEventListener('click', randomRecommend);

showAllBtn.addEventListener('click', () => {
    currentCategory = 'all';
    categoryBtn.textContent = '全部菜谱';
    displayContentByCategory(); // 调用新的函数
});

categoryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    categoryDropdown.style.display = categoryDropdown.style.display === 'block' ? 'none' : 'block';
});

categoryDropdown.addEventListener('click', (e) => {
    const target = e.target;
    if (target.dataset.value) {
        const selectedType = target.dataset.type || 'recipes'; // 默认是菜谱
        const selectedCategory = target.dataset.value;

        // 如果点击的是一个文档项
        if (selectedType === 'document') {
            const docCategory = target.dataset.category; // 获取文档所属的顶层分类 (例如 '小贴士')
            const docName = selectedCategory; // 文档名称本身就是 dataset.value

            currentCategory = docName; // 可以将当前类别设为文档名称
            categoryBtn.textContent = target.textContent;
            categoryDropdown.style.display = 'none';
            displayContentByCategory(docCategory, 'document', docName); // 调用函数显示文档内容
        } else {
            // 如果点击的是菜谱分类 (或 '全部菜谱')
            currentCategory = selectedCategory; // 更新当前选择的分类
            categoryBtn.textContent = target.textContent;
            categoryDropdown.style.display = 'none';
            displayContentByCategory(selectedCategory, selectedType);
        }
    }
});

window.addEventListener('click', () => {
    if (categoryDropdown.style.display === 'block') {
        categoryDropdown.style.display = 'none';
    }
});


// 页面加载后开始执行
initializeRecipes();