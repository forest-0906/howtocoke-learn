// =========================================================
// 全局变量和DOM元素引用
// =========================================================
let allRecipes = {};
let allDocuments = {}; // 用于存储非菜谱的Markdown文档
let categoryHierarchy = {};
let displayedRecipes = []; // To hold recipes currently displayed, for search filtering
let currentCategory = 'all'; // Default current category, 'all' means all recipes
let currentSearchTerm = ''; // Store current search term

const REPO_OWNER = 'Anduin2017';
const REPO_NAME = 'HowToCook';
const GITHUB_TREES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/master?recursive=1`;
const GITHUB_TOKEN = ''; // 如果需要，在这里填写你的GitHub Personal Access Token

// DOM元素引用
const categoryBtn = document.getElementById('category-btn');
const categoryDropdown = document.getElementById('category-dropdown');
const showAllBtn = document.getElementById('show-all-btn');
const recipesContainer = document.getElementById('recipes-container');
const searchInput = document.getElementById('search-input'); // Search input

// DOM elements for new random feature
const randomBtnLarge = document.getElementById('random-btn-large');
const randomCardText = document.getElementById('random-card-text');
const spinnerDisplayLarge = document.getElementById('spinner-display-large');

// DOM elements for random recipe detail modal
const randomRecipeDetailModal = document.getElementById('random-recipe-detail-modal');
const modalCloseBtn = randomRecipeDetailModal.querySelector('.modal-close-btn');
const modalRecipeName = document.getElementById('modal-recipe-name');
const modalRecipeContent = document.getElementById('modal-recipe-content');


// 分类名映射表 (优化：保持与目录结构一致，仅用于显示名称转换)
const CATEGORY_MAP = {
    'aquatic': '水产', 'breakfast': '早餐', 'condiment': '调味品',
    'dessert': '甜点', 'drink': '饮品', 'meat_dish': '肉类菜',
    'soup': '汤与粥', 'staple': '主食', 'vegetable_dish': '素菜',
    'semi-finished': '半成品加工', 'cold-dish': '凉菜', 'hard-dishes': '硬菜',
    'miscellaneous': '小贴士', // 新增杂项分类用于文档
    'snack': '小吃', // 示例：如果你的数据中有更多分类
    'western-food': '西餐', // 示例
    'chinese-food': '中餐', // 示例
    'advanced': '进阶',     // 【新增翻译】
    'learn': '学习资料'     // 【新增翻译】
};

// 需要排除的文件或目录模式
const EXCLUDED_PATHS_REGEX = [
    /^\.github\//,              // 排除 .github 目录及其内容
    /^pull_request_template\.md$/, // 排除根目录下的 pull_request_template.md
    /^README_TEMPLATE\.md$/,     // 排除根目录下的 README_TEMPLATE.md
    /^README\.md$/,              // 排除根目录下的 README.md (如果不想显示)
    /^CONTRIBUTING\.md$/,        // 排除 CONTRIBUTING.md
    /^LICENSE$/,                 // 排除 LICENSE 文件
    /^images\//                 // 排除 images 目录
];


// =========================================================
// 功能函数
// =========================================================

/**
 * 从GitHub API获取仓库内容树，并构建分类层次结构和菜谱/文档数据。
 */
async function fetchRepoTree() {
    recipesContainer.innerHTML = '<div class="loading">正在加载菜谱，请稍候...</div>';
    try {
        const response = await fetch(GITHUB_TREES_API_URL, {
            headers: GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {}
        });
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.statusText}`);
        }
        const data = await response.json();
        const tree = data.tree;

        categoryHierarchy = {
            'all': { name: '全部菜谱', path: '', type: 'category', children: {} } // 根“全部”分类
        };

        const markdownFiles = tree.filter(file => file.path.endsWith('.md') && file.type === 'blob');

        for (const file of markdownFiles) {
            // 【修复2】过滤不需要的文件和路径
            const isExcluded = EXCLUDED_PATHS_REGEX.some(regex => regex.test(file.path));
            if (isExcluded) {
                continue; // 跳过当前文件
            }

            const parts = file.path.split('/');
            if (parts.length < 2) continue; // 至少需要 'category/filename.md'

            const topCategoryKey = parts[0];
            const fileName = parts[parts.length - 1];
            const filePath = file.path;

            // 根据顶级分类判断是菜谱还是文档
            if (topCategoryKey === 'miscellaneous' || topCategoryKey === 'tools' || topCategoryKey === 'advanced' || topCategoryKey === 'learn') { // 假设 'miscellaneous' 和 'tools', 'advanced', 'learn' 目录存放文档
                if (!allDocuments[topCategoryKey]) {
                    allDocuments[topCategoryKey] = {};
                }
                allDocuments[topCategoryKey][fileName] = {
                    path: filePath,
                    sha: file.sha,
                    content: null // 初始内容为空，按需加载
                };
                // 构建文档的分类层级
                if (!categoryHierarchy[topCategoryKey]) {
                    categoryHierarchy[topCategoryKey] = { name: CATEGORY_MAP[topCategoryKey] || topCategoryKey, path: topCategoryKey, type: 'documentCategory', children: {} };
                }
                const docNameWithoutExt = fileName.replace(/\.md$/, '');
                categoryHierarchy[topCategoryKey].children[docNameWithoutExt] = {
                    name: docNameWithoutExt, // 或从文件内容中解析标题
                    path: filePath,
                    type: 'document',
                    parentCategory: topCategoryKey // 添加父分类信息
                };

            } else { // 假定其他都是菜谱分类
                const categoryName = CATEGORY_MAP[topCategoryKey] || topCategoryKey;

                // 构建菜谱分类层级
                if (!categoryHierarchy[topCategoryKey]) {
                    categoryHierarchy[topCategoryKey] = { name: categoryName, path: topCategoryKey, type: 'category', children: {} };
                    categoryHierarchy.all.children[topCategoryKey] = categoryHierarchy[topCategoryKey]; // 将所有顶级菜谱分类添加到“全部菜谱”下
                }

                if (parts.length === 2) { // 直接在顶级分类下的菜谱 (e.g., meat_dish/beef.md)
                    const recipeName = fileName.replace(/\.md$/, '');
                    allRecipes[filePath] = {
                        name: recipeName,
                        category: topCategoryKey,
                        path: filePath,
                        sha: file.sha,
                        content: null // 初始内容为空，按需加载
                    };
                    categoryHierarchy[topCategoryKey].children[recipeName] = { name: recipeName, path: filePath, type: 'recipe' };

                } else if (parts.length >= 3) { // 存在子分类的菜谱 (e.g., meat_dish/poultry/chicken.md)
                    const subCategoryKey = parts[1];
                    const subCategoryName = CATEGORY_MAP[subCategoryKey] || subCategoryKey;

                    if (!categoryHierarchy[topCategoryKey].children[subCategoryKey]) {
                        categoryHierarchy[topCategoryKey].children[subCategoryKey] = { name: subCategoryName, path: `${topCategoryKey}/${subCategoryKey}`, type: 'subcategory', children: {} };
                    }
                    const recipeName = fileName.replace(/\.md$/, '');
                    allRecipes[filePath] = {
                        name: recipeName,
                        category: topCategoryKey, // 主分类
                        subCategory: subCategoryKey, // 子分类
                        path: filePath,
                        sha: file.sha,
                        content: null
                    };
                    categoryHierarchy[topCategoryKey].children[subCategoryKey].children[recipeName] = { name: recipeName, path: filePath, type: 'recipe' };
                }
            }
        }
        createCategoryDropdown();
        displayContentByCategory('all'); // 初始显示全部菜谱
    } catch (error) {
        console.error('Error fetching repo tree:', error);
        recipesContainer.innerHTML = '<div class="error">加载菜谱失败，请检查网络或稍后再试。</div>';
    }
}

/**
 * 根据Markdown文件路径获取并渲染内容。
 * @param {string} filePath - GitHub raw content URL or local path.
 * @returns {Promise<string>} - HTML string of the rendered Markdown.
 */
async function fetchAndRenderMarkdown(filePath) {
    const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/${filePath}`;
    try {
        const response = await fetch(rawUrl, {
            headers: GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {}
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch markdown: ${response.statusText}`);
        }
        const markdown = await response.text();
        // 使用marked库将Markdown转换为HTML
        return marked.parse(markdown);
    } catch (error) {
        console.error('Error fetching or rendering markdown:', error);
        return `<p class="error">无法加载内容：${error.message}</p>`;
    }
}

/**
 * 根据选定的分类或搜索词显示内容。
 * @param {string} categoryKey - 分类键 ('all', 'aquatic', 'miscellaneous' 等)。
 * @param {string} [contentType='recipes'] - 显示内容的类型 ('recipes' 或 'document')。
 * @param {string} [documentName=''] - 如果是文档，指定文档名称。
 */
async function displayContentByCategory(categoryKey, contentType = 'recipes', documentName = '') {
    recipesContainer.innerHTML = '<div class="loading">正在加载内容...</div>';
    displayedRecipes = []; // Reset displayed recipes for search filtering

    if (contentType === 'document' && documentName) {
        // 显示单个文档内容
        const docCategoryKey = categoryKey; // 文档的父分类
        const docPath = allDocuments[docCategoryKey]?.[documentName]?.path;

        if (docPath) {
            const htmlContent = await fetchAndRenderMarkdown(docPath);
            recipesContainer.innerHTML = `<div class="document-content"><h2>${CATEGORY_MAP[docCategoryKey] || docCategoryKey} - ${documentName.replace(/\.md$/, '')}</h2>${htmlContent}</div>`;
        } else {
            recipesContainer.innerHTML = '<div class="error">找不到指定的文档。</div>';
        }
        return; // 文档显示后直接返回
    }

    // 处理菜谱显示
    let recipesToDisplay = [];
    if (categoryKey === 'all') {
        recipesToDisplay = Object.values(allRecipes);
    } else {
        // 筛选出属于当前分类的菜谱
        recipesToDisplay = Object.values(allRecipes).filter(recipe => {
            return recipe.category === categoryKey || (recipe.subCategory && recipe.subCategory === categoryKey);
        });
    }

    if (recipesToDisplay.length === 0) {
        recipesContainer.innerHTML = '<div class="loading">此分类下暂无菜谱。</div>';
        return;
    }

    // 渲染菜谱卡片
    recipesContainer.innerHTML = ''; // Clear previous content
    displayedRecipes = recipesToDisplay; // Store for potential search filtering
    renderRecipeCards(recipesToDisplay);
}

/**
 * 渲染菜谱卡片到容器中。
 * @param {Array<Object>} recipes - 要渲染的菜谱对象数组。
 */
function renderRecipeCards(recipes) {
    if (recipes.length === 0) {
        recipesContainer.innerHTML = '<div class="loading">没有找到匹配的菜谱。</div>';
        return;
    }
    recipesContainer.innerHTML = ''; // Clear previous cards
    recipes.forEach(recipe => {
        const recipeCard = document.createElement('div');
        recipeCard.className = 'recipe';
        recipeCard.dataset.path = recipe.path; // Store path for fetching full content
        const categoryTag = CATEGORY_MAP[recipe.category] || recipe.category;
        const subCategoryTag = recipe.subCategory ? (CATEGORY_MAP[recipe.subCategory] || recipe.subCategory) : '';

        recipeCard.innerHTML = `
            <div class="recipe-title">
                ${recipe.name}
                <span class="recipe-expand-icon">▼</span>
            </div>
            <div class="recipe-tags">
                <span class="tag category-tag">${categoryTag}</span>
                ${subCategoryTag ? `<span class="tag difficulty-tag">${subCategoryTag}</span>` : ''}
            </div>
            <div class="recipe-content-detail">
                </div>
        `;
        recipesContainer.appendChild(recipeCard);
    });

    // Add event listeners to newly created recipe cards
    document.querySelectorAll('.recipe').forEach(card => {
        card.addEventListener('click', async function(e) {
            // Prevent toggling if a link inside is clicked
            if (e.target.tagName === 'A' || e.target.closest('a')) {
                return;
            }

            const contentDetail = this.querySelector('.recipe-content-detail');
            const expandIcon = this.querySelector('.recipe-expand-icon');
            const filePath = this.dataset.path;
            const recipeObj = Object.values(allRecipes).find(r => r.path === filePath); // Get the actual recipe object

            if (contentDetail.style.display === 'block') {
                // Collapse
                contentDetail.style.display = 'none';
                this.classList.remove('expanded');
            } else {
                // Expand
                if (filePath && !recipeObj.content) { // Only fetch if not already fetched
                    contentDetail.innerHTML = '<p>加载中...</p>';
                    const htmlContent = await fetchAndRenderMarkdown(filePath);
                    contentDetail.innerHTML = htmlContent;
                    // Store content to avoid re-fetching
                    recipeObj.content = htmlContent;
                }
                contentDetail.style.display = 'block';
                this.classList.add('expanded');
            }
        });
    });
}


/**
 * 动态创建分类下拉菜单。
 */
function createCategoryDropdown() {
    categoryDropdown.innerHTML = ''; // 清空现有内容

    // 添加“全部菜谱”选项
    const allItem = document.createElement('a');
    allItem.href = '#';
    allItem.className = 'category-item';
    allItem.dataset.value = 'all';
    allItem.dataset.type = 'recipes';
    allItem.textContent = '全部菜谱';
    categoryDropdown.appendChild(allItem);

    // 遍历分类层次结构
    for (const key in categoryHierarchy) {
        if (key === 'all') continue; // 跳过根“全部”分类，因为已经手动添加

        const category = categoryHierarchy[key];
        // 过滤掉没有实际内容的“分类”（比如只包含被排除文件的目录）
        if (Object.keys(category.children).length === 0 && category.type !== 'documentCategory') {
            continue;
        }

        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = category.name;
        categoryDropdown.appendChild(header);

        for (const childKey in category.children) {
            const child = category.children[childKey];
            const item = document.createElement('a');
            item.href = '#';
            item.textContent = child.name;

            if (child.type === 'recipe' || child.type === 'subcategory') {
                item.className = 'subcategory-item'; // For subcategories and direct recipes
                // For direct recipes under a top category (not a subcategory)
                if (child.type === 'recipe') {
                    item.dataset.value = category.path; // Filter by top category key
                } else {
                    item.dataset.value = childKey; // Filter by subcategory key
                }
                item.dataset.type = 'recipes';

            } else if (child.type === 'document') {
                item.className = 'document-item';
                item.dataset.value = child.name; // 文档的名称
                item.dataset.type = 'document';
                item.dataset.category = category.path; // 记录其父分类，用于fetch
            }
            categoryDropdown.appendChild(item);
        }
    }
}

/**
 * 执行搜索操作，根据搜索词过滤当前显示的菜谱。
 */
function performSearch() {
    currentSearchTerm = searchInput.value.toLowerCase();
    let filteredRecipes = [];

    if (!currentSearchTerm) {
        // 如果搜索词为空，则根据当前分类重新显示
        displayContentByCategory(currentCategory);
        return;
    }

    // 从allRecipes中过滤，而不是displayedRecipes，确保跨所有加载的菜谱搜索
    const recipesToSearch = Object.values(allRecipes).filter(recipe => {
        if (currentCategory === 'all' || recipe.category === currentCategory || (recipe.subCategory && recipe.subCategory === currentCategory)) {
            return true; // 包含在当前选定分类下的所有菜谱
        }
        return false;
    });


    filteredRecipes = recipesToSearch.filter(recipe => {
        const nameMatch = recipe.name.toLowerCase().includes(currentSearchTerm);
        const categoryMatch = (CATEGORY_MAP[recipe.category] || recipe.category).toLowerCase().includes(currentSearchTerm);
        const subCategoryMatch = recipe.subCategory && (CATEGORY_MAP[recipe.subCategory] || recipe.subCategory).toLowerCase().includes(currentSearchTerm);

        // 如果内容已经加载，则搜索内容
        const contentMatch = recipe.content && recipe.content.toLowerCase().includes(currentSearchTerm);

        return nameMatch || categoryMatch || subCategoryMatch || contentMatch;
    });

    renderRecipeCards(filteredRecipes);
}

/**
 * 显示随机菜谱的模态框。
 * @param {Object} recipe - 随机选中的菜谱对象。
 */
async function showRandomRecipeDetailModal(recipe) {
    if (!recipe) {
        modalRecipeName.textContent = '未找到菜谱';
        modalRecipeContent.innerHTML = '<p>抱歉，未能在当前分类下找到可推荐的菜谱。</p>';
        randomRecipeDetailModal.classList.add('visible');
        return;
    }

    modalRecipeName.textContent = recipe.name;
    modalRecipeContent.innerHTML = '<p>加载中...</p>'; // 显示加载提示

    // 确保内容已加载，如果未加载则获取
    if (!recipe.content) {
        const htmlContent = await fetchAndRenderMarkdown(recipe.path);
        recipe.content = htmlContent; // 存储内容以避免重复获取
    }
    modalRecipeContent.innerHTML = recipe.content;
    randomRecipeDetailModal.classList.add('visible');
}

/**
 * 关闭随机菜谱详情模态框。
 */
function closeRandomRecipeDetailModal() {
    randomRecipeDetailModal.classList.remove('visible');
    // 清空内容以备下次加载
    modalRecipeName.textContent = '';
    modalRecipeContent.innerHTML = '';
}

// =========================================================
// 事件监听器
// =========================================================

// 初始化加载菜谱和文档
document.addEventListener('DOMContentLoaded', initializeRecipes);

// 全局初始化函数
async function initializeRecipes() {
    await fetchRepoTree();
}

// “显示全部”按钮点击事件
showAllBtn.addEventListener('click', () => {
    currentCategory = 'all';
    currentSearchTerm = '';
    searchInput.value = '';
    categoryBtn.textContent = '全部菜谱';
    displayContentByCategory('all'); // 明确传递 'all' 参数
});

// 分类按钮点击事件 (切换下拉菜单显示/隐藏)
categoryBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免直接关闭
    categoryDropdown.style.display = categoryDropdown.style.display === 'block' ? 'none' : 'block';
});

// 分类下拉菜单中的选项点击事件
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
            currentSearchTerm = ''; // 切换到文档时清空搜索
            searchInput.value = '';
            categoryBtn.textContent = target.textContent;
            categoryDropdown.style.display = 'none';
            displayContentByCategory(docCategory, 'document', docName); // 调用函数显示文档内容
        } else {
            // 如果点击的是菜谱分类 (或 '全部菜谱')
            currentCategory = selectedCategory; // 更新当前选择的分类
            currentSearchTerm = ''; // 清空搜索词
            searchInput.value = '';
            categoryBtn.textContent = target.textContent;
            categoryDropdown.style.display = 'none';
            displayContentByCategory(selectedCategory, selectedType);
        }
    }
});

// 随机推荐大按钮点击事件
randomBtnLarge.addEventListener('click', async () => {
    randomBtnLarge.classList.add('spinning');
    randomCardText.style.opacity = '0'; // 隐藏主文字

    let availableRecipes = [];

    if (currentCategory === 'all') {
        availableRecipes = Object.values(allRecipes);
    } else {
        // 筛选出属于当前 selectedCategory 的菜谱
        availableRecipes = Object.values(allRecipes).filter(recipe =>
            recipe.category === currentCategory || (recipe.subCategory && recipe.subCategory === currentCategory)
        );
    }

    if (availableRecipes.length === 0) {
        spinnerDisplayLarge.textContent = "当前分类无菜谱";
        spinnerDisplayLarge.classList.add('visible');
        setTimeout(() => {
            randomBtnLarge.classList.remove('spinning');
            randomCardText.style.opacity = '1';
            spinnerDisplayLarge.classList.remove('visible');
            showRandomRecipeDetailModal(null); // 显示找不到菜谱的提示
        }, 1500); // 显示几秒后复原
        return;
    }

    // 随机选择菜谱的模拟动画
    const spinCount = 15; // 旋转的次数，影响动画时长
    const intervalTime = 80; // 每次显示不同菜谱的间隔
    let currentIndex = 0;

    const spinInterval = setInterval(() => {
        const randomRecipe = availableRecipes[Math.floor(Math.random() * availableRecipes.length)];
        spinnerDisplayLarge.textContent = randomRecipe.name;
        spinnerDisplayLarge.classList.add('visible');
        currentIndex++;

        if (currentIndex >= spinCount) {
            clearInterval(spinInterval);
            // 最终选定的菜谱
            const finalRandomRecipe = availableRecipes[Math.floor(Math.random() * availableRecipes.length)];
            spinnerDisplayLarge.textContent = finalRandomRecipe.name; // 确保显示最终结果
            setTimeout(() => {
                randomBtnLarge.classList.remove('spinning');
                randomCardText.style.opacity = '1';
                spinnerDisplayLarge.classList.remove('visible');
                showRandomRecipeDetailModal(finalRandomRecipe); // 显示最终菜谱的详情
            }, 500); // 最终结果显示0.5秒后隐藏 spinner
        }
    }, intervalTime);
});


// 关闭模态框事件
modalCloseBtn.addEventListener('click', closeRandomRecipeDetailModal);

// 点击模态框背景关闭
randomRecipeDetailModal.addEventListener('click', (e) => {
    if (e.target === randomRecipeDetailModal) {
        closeRandomRecipeDetailModal();
    }
});


// 点击页面其他地方关闭分类下拉菜单
window.addEventListener('click', (event) => {
    if (categoryDropdown.style.display === 'block' && !categoryBtn.contains(event.target) && !categoryDropdown.contains(event.target)) {
        categoryDropdown.style.display = 'none';
    }
});

// 搜索输入框的事件监听
searchInput.addEventListener('input', performSearch);
