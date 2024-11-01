import Department from '../models/department.js'
import User from '../models/user.js'
import AuditLog from '../models/auditLog.js'
import { StatusCodes } from 'http-status-codes'
import { companyNames } from '../enums/Company.js'

// 創建部門
export const create = async (req, res) => {
  try {
    const { name, companyId } = req.body
    const department = await Department.create({ name, companyId })

    await AuditLog.create({
      operatorId: req.user._id,
      action: '創建',
      targetId: department._id,
      targetModel: 'departments',
      changes: {
        name,
        companyId,
        companyName: companyNames[companyId]
      }
    })

    res.status(StatusCodes.OK).json({
      success: true,
      message: '部門創建成功',
      result: {
        ...department.toObject(),
        companyName: companyNames[department.companyId]
      }
    })
  } catch (error) {
    console.error('Error creating department:', error) // 加入詳細錯誤日誌
    let errorMessage = '創建部門時發生錯誤'
    if (error.code === 11000) {
      errorMessage = '該公司已有相同名稱的部門，請更改部門名稱'
    }
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: errorMessage,
      error: error.message
    })
  }
}

// 取得所有部門
// 取得所有部門
export const getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const itemsPerPage = parseInt(req.query.itemsPerPage) || 10
    const sortBy = req.query.sortBy || 'companyId'
    const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1
    const search = req.query.search || ''
    const companyId = req.query.companyId // 新增 companyId 過濾參數

    console.log('Received query:', req.query) // 加入調試日誌

    // 構建查詢條件
    const query = {}
    if (search) {
      query.name = new RegExp(search, 'i')
    }
    if (companyId) { // 檢查 companyId 是否存在
      query.companyId = companyId
    }

    console.log('Filter query:', query) // 加入調試日誌

    // 計算總數
    const total = await Department.countDocuments(query)

    // 取得部門列表
    const departments = await Department.find(query)
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * itemsPerPage)
      .limit(itemsPerPage)

    console.log('Found departments:', departments) // 加入調試日誌

    // 取得每個部門的人數
    const departmentsWithCounts = await Promise.all(
      departments.map(async (dept) => {
        const memberCount = await User.countDocuments({
          department: dept._id,
          employmentStatus: '在職'
        })
        return {
          ...dept.toObject(),
          companyName: companyNames[dept.companyId],
          memberCount
        }
      })
    )

    console.log('Final response:', departmentsWithCounts) // 加入調試日誌

    res.status(StatusCodes.OK).json({
      success: true,
      message: '獲取部門列表成功',
      result: {
        data: departmentsWithCounts,
        totalItems: total,
        currentPage: page,
        itemsPerPage
      }
    })
  } catch (error) {
    console.error('Get departments error:', error) // 詳細的錯誤日誌
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '獲取部門列表時發生錯誤',
      error: error.message || '未知錯誤'
    })
  }
}
// 總公司人數
export const getCompanyTotalCount = async (req, res) => {
  try {
    const totalCompanyCount = await User.aggregate([
      { $group: { _id: '$companyId', total: { $sum: 1 } } }
    ])
    res.status(StatusCodes.OK).json({ totalCompanyCount })
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '計算公司總人數時發生錯誤',
      error: error.message
    })
  }
}

export const getDepartmentCounts = async (req, res) => {
  try {
    const departmentCounts = await User.aggregate([
      { $group: { _id: { companyId: '$companyId', department: '$department' }, total: { $sum: 1 } } }
    ])
    res.status(StatusCodes.OK).json({ departmentCounts })
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '計算各部門人數時發生錯誤',
      error: error.message
    })
  }
}

// 編輯部門
export const edit = async (req, res) => {
  try {
    const { name, companyId } = req.body
    const department = await Department.findByIdAndUpdate(
      req.params.id,
      { name, companyId },
      { new: true }
    )

    // 取得部門人數
    const memberCount = await User.countDocuments({
      department: department._id,
      employmentStatus: '在職'
    })

    await AuditLog.create({
      operatorId: req.user._id,
      action: '修改',
      targetId: department._id,
      targetModel: 'departments',
      changes: {
        name,
        companyId,
        companyName: companyNames[companyId]
      }
    })

    res.status(StatusCodes.OK).json({
      success: true,
      message: '部門更新成功',
      result: {
        ...department.toObject(),
        companyName: companyNames[department.companyId],
        memberCount
      }
    })
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '更新部門時發生錯誤',
      error: error.message
    })
  }
}

// 刪除部門
export const remove = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id)

    if (!department) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: '找不到指定的部門'
      })
    }

    // 檢查部門是否還有在職員工
    const memberCount = await User.countDocuments({
      department: department._id,
      employmentStatus: '在職'
    })

    if (memberCount > 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: '此部門還有在職員工，無法刪除'
      })
    }

    await department.deleteOne()
    await User.updateMany({ department: req.params.id }, { department: null })

    await AuditLog.create({
      operatorId: req.user._id,
      action: '刪除',
      targetId: department._id,
      targetModel: 'departments',
      changes: {
        name: department.name,
        companyId: department.companyId,
        companyName: companyNames[department.companyId]
      }
    })

    res.status(StatusCodes.OK).json({
      success: true,
      message: '部門刪除成功'
    })
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: '刪除部門時發生錯誤',
      error: error.message
    })
  }
}
