// @ts-check

(function Search() {

    const config = window.NSConfig

    const resultTypeProperties = {
        "product": "products",
        "collection": "collections",
        "page": "pages",
    }

    const DEBOUNCE_WAIT_MS = 200
    const CACHE_CAPACITY = 40

    const containerEl = document.querySelector(".n-s-container")
    const formEl = containerEl.querySelector("form")
    const inputEl = containerEl.querySelector(".n-s-input")
    const resultsEl = containerEl.querySelector(".n-s-results")
    const clearBtnEl = containerEl.querySelector(".n-s-clear")
    const typeSelectEl = config.showTypesSelect 
        && containerEl.querySelector(".n-s-types")

    let debounceTimeout = null
    let cache = {
        keys: [],
        store: {}
    }

    let scrollPos = 0


    function hideExtraResults() {
        const windowHeight = window.innerHeight
        const hasResults = Boolean(containerEl.querySelector(".n-s-result-group"))

        if (!hasResults) return

        const itemElements = resultsEl.querySelectorAll("li")
        for (let i = 0; i < itemElements.length; i++) {
            const itemEl = itemElements[i]
            itemEl.classList.remove("n-s-result-hidden")
        }
        
        const resultsHeight = resultsEl.getBoundingClientRect().height
        const resultsTop = resultsEl.getBoundingClientRect().top
        const resultsBottomY = resultsHeight + resultsTop
        const extraMargin = 40
        if (resultsBottomY + extraMargin <= windowHeight) return

        const heightToCrop = resultsBottomY - windowHeight + extraMargin

        
        const itemElHeight = itemElements[0].offsetHeight
        const itemsToRemoveCount = Math.ceil(heightToCrop / itemElHeight)
        
        let itemsRemovedCount = 0
        let currItemIndex = itemElements.length - 1
        while ( itemsRemovedCount < itemsToRemoveCount ) {
            const item = itemElements[currItemIndex]
            const isFirstInGroup = item === item.parentElement.firstElementChild
            if (!isFirstInGroup) {
                item.classList.add("n-s-result-hidden")
                itemsRemovedCount++
            } 
            currItemIndex--
        }
        

    }

    function onResizeOfFocused() {
        hideExtraResults()
    }

    containerEl.addEventListener('focusin', function() {
        lockBodyScroll()
        window.addEventListener('resize', onResizeOfFocused)
    })
    
    containerEl.addEventListener('focusout', function() {
        unlockBodyScroll()
        window.removeEventListener('resize', onResizeOfFocused)
    })


    formEl.addEventListener('submit', function(e) {
        const selectedTypeValue = config.showTypesSelect && typeSelectEl.value
        if (selectedTypeValue && selectedTypeValue !== config.allTypesStr ) {
            formEl.q.value = selectedTypeValue + " " + formEl.q.value
            typeSelectEl.value = config.showTypesSelect
        }

        const hiddenOpts = document.createElement("input")
        hiddenOpts.name = "options[prefix]"
        hiddenOpts.value = "last"
        formEl.appendChild(hiddenOpts)
    })

    inputEl.addEventListener('input', function(e) {
        onQueryChange(cache)
    })

    inputEl.addEventListener('keyup', function (e) {

        if (!["ArrowUp", "ArrowDown"].includes(e.code) ) return
        
        const selectedResult = getSelectedResultEl()

        if (!selectedResult) {
            const firstResultEl = resultsEl.querySelector('li')
            if (!firstResultEl) return
            firstResultEl.classList.add("n-s-selected")
            return
        }

        const allResultElements = resultsEl.querySelectorAll('li:not(.n-s-result-hidden)')
        
        if (e.code === "ArrowDown") {
            for (let i = 0; i < allResultElements.length - 1; i++) {
                const element = allResultElements[i];
                if (element === selectedResult) {
                    const nextResultEl = allResultElements[i + 1]
                    nextResultEl.classList.add("n-s-selected")
                    selectedResult.classList.remove("n-s-selected")
                }
            }
        }

        if (e.code === "ArrowUp") {
            for (let i = 1; i < allResultElements.length; i++) {
                const element = allResultElements[i];
                if (element === selectedResult) {
                    const prevResultEl = allResultElements[i - 1]
                    prevResultEl.classList.add("n-s-selected")
                    selectedResult.classList.remove("n-s-selected")
                }
            }
        }

    })

    inputEl.addEventListener('keydown', function(e) {
        if (e.code === "Enter" && Boolean(getSelectedResultEl())) {
            e.preventDefault()
        } else if (e.code === "ArrowUp" || e.code === "ArrowDown") {
            e.preventDefault()
        } else if (e.code === "Escape" ) {
            clearSearch()
            inputEl.blur()
        }
    })

    if (typeSelectEl) typeSelectEl.addEventListener("change", function (e) {
        onQueryChange(cache)
    })
    
    clearBtnEl.addEventListener('click', function(e) {
        e.preventDefault()
        clearSearch()
    })



    function onQueryChange(cache) {
        
        resultsEl.innerHTML = ""

        const inputValue = inputEl.value
        
        if ( !inputValue ) {
            clearSearch()
            return
        } 
        
        const typePrefix = config.showTypesSelect 
            && typeSelectEl.value !== config.allTypesStr
            && typeSelectEl.value + " "
        const query = (typePrefix  || "" ) + inputValue


        const cacheValue = getFromCache(query, cache)
        if (cacheValue) {
            renderResults(
                cacheValue, 
                inputValue, 
                typeSelectEl ? typeSelectEl.value : ""
            )
            return 
        } 

        const baseUrl = "/search/suggest.json"
        const queryParam = '?q=' + encodeURIComponent(query)
        const otherParams = getSearchOptsQuery(config)

        const url = baseUrl + queryParam + otherParams
        
        setLoading(true)
        function fetchResults(url) {
            fetch( url )
               .then( res => res.json() )
               .then ( res => {
                   if (inputEl.value === "") {
                        // Value might have been cleared
                        return
                   } 
                    // Success   
                    console.log(`fetched:`, res);
                    if (!validateResponse(res, Boolean(typePrefix))) {
                        // TODO show error
                        setLoading(false)
                        return
                    }
                    setInCache(query, res, cache)
                    setLoading(false)
                    renderResults(
                        res, 
                        inputEl.value, 
                        typeSelectEl ? typeSelectEl.value: ""
                    )
                    return
                } )
                .catch( err => {
                    setLoading(false)
                    clearResults()
                    return console.error(`err`, err);
            })
        } 
        
        clearTimeout(debounceTimeout)
        debounceTimeout = debounce(fetchResults, [url], DEBOUNCE_WAIT_MS)
    }

    function debounce( cb, args, wait ) {
        const newTimeout = setTimeout( function(){
            cb(...args)
        }, wait )
        return newTimeout
    }

    function setInCache(key, value, cache) {
        if ( cache.keys.length >= CACHE_CAPACITY ) {
            const oldestKey = cache.keys.splice(0, 1)
            delete cache[oldestKey]
        }
        
        cache.keys.push(key)
        cache.store[key] = value
    }

    function getFromCache( key, cache ) {
        return cache.store[key]
    }
    
    function validateResponse(res, isTypeSearch) {
        if (!res.resources) return false
        if (!res.resources.results) return false

        const results = res.resources.results

        if (isTypeSearch ) {
            if (!results["products"]) return false
        } else {
            for (const resultType of config.resultTypes) {
                const responseProperty = resultTypeProperties[resultType]
                if (!results[responseProperty]) return false
            }
        }
        // TODO validate individual types
        return true
    }

    function renderResults(res, queryStr, typeStr) {
        let resultsHTML = ""
        if (countResults(res.resources.results) === 0) {
            resultsHTML = getNoResultsHTML(queryStr, typeStr)
        } else {
            resultsHTML = getResultsHTML(
                res.resources.results, 
                queryStr,
                typeStr
            )
        }
        resultsEl.innerHTML = resultsHTML
        showResults()
        hideExtraResults()
    }

    function getNoResultsHTML(queryStr, typeStr) {
        // let result = "<div class='n-s-no-results'><p>No results</p></div>"
        let result = "<div class='n-s-no-results'>"
        result += getMoreResultsHTML(queryStr, typeStr)
        result += "</div"
        return result
    }

    function getLoadingHTML() {
        // const result = "<div><div class='n-s-loading'><div></div><div></div></div></div>"
        const result = ""
        return result
    }

    function getResultsHTML(results, queryStr, typeStr) {
        let resultsStr = "<div>"
        const hideBtnStr = "<button class='n-s-hide' onclick='document.activeElement.blur()'>HIDE</button>"
        resultsStr += hideBtnStr
        for (const resultType in results) {
            if (!results[resultType].length) continue
            resultsStr += getResultGroupHTML(
                results[resultType], 
                resultType
            )
        }

        resultsStr += getMoreResultsHTML(queryStr, typeStr)
        resultsStr += "</div>"
        return resultsStr
    }


    function getMoreResultsHTML(queryStr, typeStr) {
        
        let moreResults = "<button onclick='document.querySelector(`.n-s-submit`).click()' class='n-s-more'>Search for <b>" + queryStr + "</b>"
        if (typeStr && typeStr !== config.allTypesStr) {
            moreResults += " in " + typeStr
        }
        moreResults += "</button>"
        return moreResults
    }

    function getResultGroupHTML(array, resultType) {
        let groupStr = "<div class='n-s-result-group "
        if ( resultType === "products" ){
            groupStr += "n-s-product-results"
        }
        groupStr += "'>"
        
        let titleStr = "<h4>"

        switch (resultType) {
            case 'products':
                titleStr += "Products" 
                break
            case 'collections':
                titleStr += "Collections" 
                break
            case 'pages':
                titleStr += "Pages" 
                break
            default:
                break
        }
        
        titleStr += "</h4>"
        groupStr += titleStr
        
        let listStr = "<ul>"
        
        switch (resultType) {
            case 'products':
                for (const product of array ) {
                    listStr += getProductItemHTML(product)
                }
                break
            case 'collections':
                for (const collection of array ) {
                    listStr += getCollectionItemHTML(collection)
                }
                break
            case 'pages':
                for (const page of array ) {
                    listStr += getPageItemHTML(page)
                }
                break
            default:
                break
        }

        listStr += "</ul>"
        groupStr += listStr
        
        groupStr += "</div>"

        return groupStr
    }


    function getProductItemHTML(product) {
        let itemStr = "<li><a href='" + product.url + "'>"
        if (product.featured_image.url) {
            itemStr += getProductImageHTML(product)
        }
        itemStr += "<span>" + product.title + "</span>"
        itemStr += "</a></li>"
        return itemStr
    }

    function getProductImageHTML(product) {
        let image

        if (product.variants.length > 0 && product.variants[0].image !== null) {
            image = product.variants[0].featured_image;
        } else if (product.image) {
            image = product.featured_image;
        }

        if (!image) return "" 
            
        const match = image.url.match(
            /\.(jpg|jpeg|gif|png|bmp|bitmap|tiff|tif)(\?v=\d+)?$/i
        )

        if ( !match ) return ""

        const prefix = image.url.split(match[0])
        const suffix = match[0]

        const url = prefix[0] + '_x40' + suffix
        const alt = image.alt

        const result = "<img src='" + url + "' alt='" + alt + "'/>"
        return result
    }

    function getCollectionItemHTML(collection) {
        let itemStr = "<li><a href='" + collection.url + "'>"
        itemStr += collection.title
        itemStr += "</a></li>"
        return itemStr
    }

    function getPageItemHTML(page) {
        let itemStr = "<li><a href='" + page.url + "'>"
        itemStr += page.title
        itemStr += "</a></li>"
        return itemStr
    }

    function getSearchOptsQuery(config) {
        let resourceTypeStr = "&resources[type]="
        
        const isProductTypeSearch = config.showTypesSelect 
            && config.resultTypes.includes("product")
            && typeSelectEl.value !== config.allTypesStr

        if ( isProductTypeSearch ) {
            resourceTypeStr += "product" + ","
        } else {
            for (const resultType of config.resultTypes) {
                resourceTypeStr += resultType + ","
            }
        }
        
        resourceTypeStr = resourceTypeStr.slice(0, -1)
        const result = resourceTypeStr
        return result
    }

    function clearSearch() {
        inputEl.value = ""
        clearResults()
    }
    
    function hideResults() {
        resultsEl.classList.add("hide")
    }

    function onResultsHide() {
        resultsEl.blur()
    }

    function showResults() {
        resultsEl.classList.remove("hide")
    }
    
    function clearResults() {
        resultsEl.innerHTML = ""
        resultsEl.classList.add("hide")
    }
    
    function setLoading( isLoading ) {
        if (isLoading) {
            resultsEl.innerHTML = getLoadingHTML()
            resultsEl.classList.remove("hide")
        } else {
            resultsEl.innerHTML = ""
            resultsEl.classList.add("hide")
        }
    }

    function countResults(results) {
        let totalLengh = 0
        for (const resultType in results) {
            totalLengh += results[resultType].length
        }
        return totalLengh
    }

    function getSelectedResultEl() {
        return resultsEl.querySelector(".n-s-selected")
    }

    function lockBodyScroll() {
        scrollPos = window.pageYOffset
        document.body.style.top = -scrollPos + "px"
        document.body.classList.add("locked")
    }
    
    function unlockBodyScroll() {
        document.body.classList.remove("locked")
        window.scrollTo(0, scrollPos)
        document.body.style.top = '0'
    }



}())